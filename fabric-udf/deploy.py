"""
Deploy the Car Parks UDF definition to Fabric via the REST API.

Uses your *user* Azure CLI login (`az login`) — the UDF-specific REST APIs do not
support service principals. It:
  1. reads function_app.py,
  2. builds definition.json + resources/functions.json (+ optional requirements),
  3. base64-encodes each part,
  4. POSTs updateDefinition to the existing UDF item.

Portal steps still required afterwards (not available via REST): Publish the UDF,
turn on the public endpoint, and copy the invocation URL. See README.md.

Usage:
  python deploy.py --workspace <wsId> --udf <udfId> [--lakehouse <lhId>] [--create "Name"]

If --udf is omitted and --create is given, a new UDF item is created first.
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
DEFAULT_LAKEHOUSE = "b97fcfa2-6e58-4898-ab81-00ed5d1396cb"
LAKEHOUSE_ALIAS = "carparkslh"


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


def build_parts(workspace_id: str, lakehouse_id: str) -> list:
    with open("function_app.py", "r", encoding="utf-8") as f:
        function_app = f.read()

    definition = {
        "$schema": "https://developer.microsoft.com/json-schemas/fabric/item/userDataFunction/definition/1.1.0/schema.json",
        "runtime": "PYTHON",
        "connectedDataSources": [
            {
                "alias": LAKEHOUSE_ALIAS,
                "artifactId": lakehouse_id,
                "artifactType": "Lakehouse",
                "workspaceId": workspace_id,
            }
        ],
        "functions": [
            {"name": "get_car_parks", "description": "Return the Car_Parks GeoJSON FeatureCollection", "isPublicEndpointEnabled": True},
            {"name": "ping", "description": "Health check", "isPublicEndpointEnabled": True},
        ],
        "libraries": {
            "public": [{"name": "fabric-user-data-functions", "type": "PYPI", "version": "1.0"}],
            "private": [],
        },
    }

    functions_meta = {
        "runtime": "PYTHON",
        "functionsMetadata": [
            {
                "name": "get_car_parks",
                "scriptFile": "function_app.py",
                "bindings": [
                    {"methods": ["POST"], "route": "", "authLevel": "Anonymous", "name": "req", "direction": "In", "type": "HttpTrigger"},
                    {"itemType": None, "subType": "FabricLakehouseClient", "alias": LAKEHOUSE_ALIAS, "name": "lakehouse", "direction": "In", "type": "FabricItem"},
                ],
                "fabricProperties": {
                    "fabricMetadataSchemaVersion": "1.1.0",
                    "fabricFunctionParameters": [],
                    "fabricFunctionReturnType": "dict",
                },
            },
            {
                "name": "ping",
                "scriptFile": "function_app.py",
                "bindings": [
                    {"methods": ["POST"], "route": "", "authLevel": "Anonymous", "name": "req", "direction": "In", "type": "HttpTrigger"},
                ],
                "fabricProperties": {
                    "fabricMetadataSchemaVersion": "1.1.0",
                    "fabricFunctionParameters": [],
                    "fabricFunctionReturnType": "str",
                },
            },
        ],
    }

    return [
        {"path": "function_app.py", "payload": b64(function_app), "payloadType": "InlineBase64"},
        {"path": "definition.json", "payload": b64(json.dumps(definition, indent=2)), "payloadType": "InlineBase64"},
        {"path": "resources/functions.json", "payload": b64(json.dumps(functions_meta, indent=2)), "payloadType": "InlineBase64"},
    ]


def api(method: str, url: str, token: str, body: dict = None):
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


def wait_lro(location: str, token: str):
    for _ in range(60):
        status, body, _ = api("GET", location, token)
        state = body.get("status")
        if state in ("Succeeded", "Completed"):
            return True, body
        if state in ("Failed", "Undefined"):
            return False, body
        time.sleep(3)
    return False, {"status": "Timeout"}


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--workspace", default=DEFAULT_WORKSPACE)
    p.add_argument("--udf", default=None)
    p.add_argument("--lakehouse", default=DEFAULT_LAKEHOUSE)
    p.add_argument("--create", default=None, help="Create a new UDF item with this display name")
    args = p.parse_args()

    token = az_token(FABRIC_RESOURCE)

    udf_id = args.udf
    if not udf_id:
        if not args.create:
            sys.exit("Provide --udf <id> or --create <displayName>.")
        status, body, _ = api("POST", f"{FABRIC_BASE}/workspaces/{args.workspace}/userDataFunctions",
                              token, {"displayName": args.create})
        if status not in (200, 201):
            sys.exit(f"Create failed ({status}): {body}")
        udf_id = body["id"]
        print(f"Created UDF item: {udf_id}")

    parts = build_parts(args.workspace, args.lakehouse)
    url = f"{FABRIC_BASE}/workspaces/{args.workspace}/userDataFunctions/{udf_id}/updateDefinition"
    status, body, headers = api("POST", url, token, {"definition": {"parts": parts}})

    if status == 202:
        location = headers.get("Location") or headers.get("location")
        print("updateDefinition accepted; polling LRO…")
        ok, result = wait_lro(location, token)
        print("LRO result:", result.get("status"))
        if not ok:
            sys.exit("updateDefinition failed: " + json.dumps(result))
    elif status in (200, 201):
        print("updateDefinition succeeded.")
    else:
        sys.exit(f"updateDefinition failed ({status}): {json.dumps(body)}")

    print(f"\nDone. UDF id: {udf_id}")
    print("Next (portal): open the item, verify the 'carparks_lh' connection, Publish,")
    print("enable the public endpoint, and copy the invocation URL into ..\\.env (UDF_ENDPOINT).")


if __name__ == "__main__":
    main()
