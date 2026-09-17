"""
Generic Fabric User Data Function deployer.

Reads a spec.json + function_app.py and deploys the UDF item definition via the
Fabric REST API (create if needed, then updateDefinition). Uses your *user* az
login (UDF REST APIs do not support service principals).

Portal steps still required afterwards (not in REST): Publish + copy the public
URL. See docs/common-udf-guide.md.

spec.json shape:
{
  "displayName": "AirportsApi",
  "libraries": [{"name":"fabric-user-data-functions","type":"PYPI","version":"1.0"}],
  "connectedDataSources": [
    {"alias":"airportssql","artifactId":"<id>","artifactType":"Lakehouse","workspaceId":"<ws>"}
  ],
  "functions": [
    {
      "name":"get_airports","returnType":"list","description":"",
      "params":[{"name":"limit","dataType":"int"}],
      "connection":{"alias":"airportssql","argName":"sqldb","subType":"FabricSqlConnection"}
    }
  ]
}

Notes:
- Connection aliases must be ALPHANUMERIC only (no underscores/hyphens).
- UDF function parameters may NOT have default values.

Usage:
  python deploy_udf.py --spec airports/spec.json --script airports/function_app.py [--udf <id>] [--workspace <ws>]
"""

import argparse
import base64
import json
import subprocess
import sys
import time
import urllib.request
import urllib.error

FABRIC_BASE = "https://api.fabric.microsoft.com/v1"
FABRIC_RESOURCE = "https://api.fabric.microsoft.com"
DEFAULT_WORKSPACE = "61077f32-d21a-4791-b383-cacbddf222f5"


def az_token(resource: str) -> str:
    out = subprocess.run(
        ["az", "account", "get-access-token", "--resource", resource, "--query", "accessToken", "-o", "tsv"],
        capture_output=True, text=True, shell=True,
    )
    if out.returncode != 0 or not out.stdout.strip():
        sys.exit("Failed to get token. Run `az login`.\n" + out.stderr)
    return out.stdout.strip()


def b64(text: str) -> str:
    return base64.b64encode(text.encode("utf-8")).decode("ascii")


def build_parts(spec: dict, script: str) -> list:
    definition = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/userDataFunction/definition/1.1.0/schema.json",
        "runtime": "PYTHON",
        "connectedDataSources": spec.get("connectedDataSources", []),
        "functions": [
            {"name": f["name"], "description": f.get("description", ""), "isPublicEndpointEnabled": True}
            for f in spec["functions"]
        ],
        "libraries": {
            "public": spec.get("libraries", [{"name": "fabric-user-data-functions", "type": "PYPI", "version": "1.0"}]),
            "private": [],
        },
    }

    functions_meta = {"runtime": "PYTHON", "functionsMetadata": []}
    for f in spec["functions"]:
        bindings = [
            {"methods": ["POST"], "route": "", "authLevel": "Anonymous", "name": "req", "direction": "In", "type": "HttpTrigger"}
        ]
        conn = f.get("connection")
        if conn:
            bindings.append({
                "itemType": None, "subType": conn["subType"], "alias": conn["alias"],
                "name": conn["argName"], "direction": "In", "type": "FabricItem",
            })
        functions_meta["functionsMetadata"].append({
            "name": f["name"],
            "scriptFile": "function_app.py",
            "bindings": bindings,
            "fabricProperties": {
                "fabricMetadataSchemaVersion": "1.1.0",
                "fabricFunctionParameters": [{"dataType": p["dataType"], "name": p["name"]} for p in f.get("params", [])],
                "fabricFunctionReturnType": f.get("returnType", "dict"),
            },
        })

    return [
        {"path": "function_app.py", "payload": b64(script), "payloadType": "InlineBase64"},
        {"path": "definition.json", "payload": b64(json.dumps(definition, indent=2)), "payloadType": "InlineBase64"},
        {"path": "resources/functions.json", "payload": b64(json.dumps(functions_meta, indent=2)), "payloadType": "InlineBase64"},
    ]


def api(method, url, token, body=None):
    data = json.dumps(body).encode("utf-8") if body is not None else None
    req = urllib.request.Request(url, data=data, method=method,
                                 headers={"Authorization": "Bearer " + token, "Content-Type": "application/json"})
    try:
        resp = urllib.request.urlopen(req)
        raw = resp.read().decode("utf-8")
        return resp.status, (json.loads(raw) if raw else {}), dict(resp.headers)
    except urllib.error.HTTPError as e:
        raw = e.read().decode("utf-8")
        return e.code, (json.loads(raw) if raw.strip().startswith("{") else {"raw": raw}), dict(e.headers)


def wait_lro(location, token):
    for _ in range(80):
        _, body, _ = api("GET", location, token)
        state = body.get("status")
        if state in ("Succeeded", "Completed"):
            return True, body
        if state in ("Failed", "Undefined"):
            return False, body
        time.sleep(3)
    return False, {"status": "Timeout"}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--spec", required=True)
    p.add_argument("--script", required=True)
    p.add_argument("--udf", default=None)
    p.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    args = p.parse_args()

    with open(args.spec, "r", encoding="utf-8") as f:
        spec = json.load(f)
    with open(args.script, "r", encoding="utf-8") as f:
        script = f.read()

    token = az_token(FABRIC_RESOURCE)
    udf_id = args.udf
    if not udf_id:
        status, body, _ = api("POST", f"{FABRIC_BASE}/workspaces/{args.workspace}/userDataFunctions",
                              token, {"displayName": spec["displayName"]})
        if status not in (200, 201):
            sys.exit(f"Create failed ({status}): {body}")
        udf_id = body["id"]
        print(f"Created UDF item: {udf_id}")

    parts = build_parts(spec, script)
    url = f"{FABRIC_BASE}/workspaces/{args.workspace}/userDataFunctions/{udf_id}/updateDefinition"
    status, body, headers = api("POST", url, token, {"definition": {"parts": parts}})
    if status == 202:
        location = headers.get("Location") or headers.get("location")
        ok, result = wait_lro(location, token)
        print("updateDefinition:", result.get("status"))
        if not ok:
            sys.exit("Failed: " + json.dumps(result))
    elif status in (200, 201):
        print("updateDefinition: Succeeded")
    else:
        sys.exit(f"updateDefinition failed ({status}): {json.dumps(body)}")

    print(f"UDF_ID={udf_id}")
    print("Next: Publish in the portal (Run only → Properties → Public URL). See docs/common-udf-guide.md")


if __name__ == "__main__":
    main()
