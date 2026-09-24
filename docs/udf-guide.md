# Fabric User Data Functions

> **Journey:** [README](../README.md) → [Data setup](data_setup.md) + **UDF guide** → [UDF setup](setup.md) → [App deployment](app-guide.md) → [Authorization](auth.md)

This primer explains what a Fabric User Data Function is and how it fits between your data and an application.

## What a Fabric UDF is

A Fabric User Data Function (UDF) is serverless Python hosted in Microsoft Fabric. When you publish it, Fabric exposes it as an internet-reachable REST endpoint protected by Microsoft Entra ID; it is never anonymous. In this solution, the UDF acts as a controlled boundary that returns only the data the map needs.

## How it works

You write a Python function that reads data and returns JSON. If your source supports a Fabric-managed connection, such as a Lakehouse, you connect it to the UDF and Fabric brokers authentication, so you do not put credentials in your code.

If you have a source without a managed connection, such as Eventhouse/Kusto, the function can connect using the UDF's own managed identity. For the access steps used by this solution, see [Authorization and identity](./auth.md).

## Lifecycle

The basic lifecycle is **Develop → Publish → Run only → Public access on → invoke with a Microsoft Entra token**. Public access makes the endpoint reachable by your Node app, while Microsoft Entra authentication ensures that only authorized callers can run it.

## Read more

- For reference, see [Fabric user data functions overview](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-overview).
- For reference, see [Create a UDF item in the portal](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/create-user-data-functions-portal).
- For reference, see [Connect to data sources](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/connect-to-data-sources).
- For reference, see [Invoke a UDF from an application](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/tutorial-invoke-from-python-app).
- For reference, see [Service details and limitations](https://learn.microsoft.com/en-us/fabric/data-engineering/user-data-functions/user-data-functions-service-limits).

## Next step

Continue to [Set up the UDFs](./setup.md) to create the four UDF items, configure their source-specific connections or libraries, publish them, and record their Public URLs.
