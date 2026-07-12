---
name: diagnose-azure-container-app
description: Diagnose why an Azure Container App is failing to start by retrieving system events and application console logs. Use when a deploy fails due to a health check timeout, startup probe failure, or the container app is crash-looping.
---

# Azure Container App Log Diagnosis

Use this skill when a deployment fails because a Container App health check timed out, a startup probe failed, or the app is crash-looping. The goal is to get the actual application logs that explain *why* the container can't start.

## Prerequisites

- `az` CLI authenticated (`az login` already done)
- Know the container app name and resource group (or discover them below)

## Step 1: Identify the Container App

If you don't already know the app name and resource group:

```bash
az containerapp list --query "[].{name:name, resourceGroup:resourceGroup}" -o table
```

## Step 2: Get System Events

System events show whether the container is pulling images, failing probes, or crash-looping:

```bash
az containerapp logs show -n <APP_NAME> -g <RESOURCE_GROUP> --type system --tail 100
```

Look for:
- `ReplicaUnhealthy` / `Startup probe failed` — app isn't binding to its port in time
- `ContainerBackOff` / `Persistent Failure to start container` — crash loop
- `ImagePullBackOff` — image registry or tag issue

## Step 3: Get Application Console Logs via Log Analytics

The `az containerapp logs show --type console` often returns empty results for crashed containers. Use Log Analytics instead.

### 3a: Get the Log Analytics workspace ID

```bash
ENV_NAME=$(az containerapp show -n <APP_NAME> -g <RESOURCE_GROUP> --query "properties.managedEnvironmentId" -o tsv | xargs -I{} basename {})
WORKSPACE_ID=$(az containerapp env show -n "$ENV_NAME" -g <RESOURCE_GROUP> --query "properties.appLogsConfiguration.logAnalyticsConfiguration.customerId" -o tsv)
```

### 3b: Query console logs

```bash
az monitor log-analytics query -w "$WORKSPACE_ID" \
  --analytics-query "ContainerAppConsoleLogs_CL | where ContainerAppName_s == '<APP_NAME>' | where TimeGenerated > ago(1h) | order by TimeGenerated desc | take 80 | project TimeGenerated, Log_s, RevisionName_s" \
  -o table
```

The output may be large — read the full output and look for:
- **Stack traces / exceptions** — the root cause (e.g., `BeanDefinitionStoreException`, `ConflictingBeanDefinitionException`, missing config)
- **`Application run failed`** — confirms the app crashed during startup
- Lines from the **most recent revision** (highest `--NNNNNN` suffix)

## Step 4: Interpret and Fix

Common failure patterns:
| Log Pattern | Likely Cause |
|---|---|
| `ConflictingBeanDefinitionException` | Duplicate Spring bean names across packages |
| `connection refused` on DB/external service | Missing or wrong env vars / secrets |
| `NoSuchBeanDefinitionException` | Missing dependency or config class |
| `Port already in use` / never binds | Wrong `SERVER_PORT` or app crash before listen |
| `ImagePullBackOff` | Wrong image tag, registry auth, or ACR not accessible |

After identifying the cause, fix the source code or configuration and redeploy.
