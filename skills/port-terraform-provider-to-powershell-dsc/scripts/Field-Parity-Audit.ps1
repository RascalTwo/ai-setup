<#
.SYNOPSIS
    Deterministic field-parity audit: for every managed resource in the provider
    schema dump, report which non-computed input attributes are NOT present as a
    [DscProperty] on the corresponding class. The enforceable field-parity gate.

    Comparison is normalized (strip underscores, lowercase) so casing/abbreviation
    differences (ClientId vs client_id) match. Computed-only attributes are excluded
    (they're outputs, not inputs — Terraform doesn't let you set them either).

.PARAMETER Detail
    List the missing field names per resource, not just counts.
#>
[CmdletBinding()] param([switch] $Detail)
$root = Split-Path $PSScriptRoot -Parent
$schema = Get-Content (Join-Path $root '.schema-dump' 'schema.json') -Raw | ConvertFrom-Json
$psm1 = Get-Content (Join-Path $root 'module' 'KeycloakDSC' 'KeycloakDSC.psm1') -Raw

$resSchemas = $schema.provider_schemas.PSObject.Properties.Value.resource_schemas
$resSchemas = $resSchemas.PSObject.Properties

function Norm($s) { ($s -replace '_','').ToLower() }
function ClassName($res) {
    $parts = ($res -replace '^keycloak_','') -split '_' | ForEach-Object { $_.Substring(0,1).ToUpper() + $_.Substring(1) }
    return 'Keycloak' + ($parts -join '')
}

# index each class's [DscProperty] names (normalized)
$classProps = @{}
foreach ($m in [regex]::Matches($psm1, '(?ms)^class\s+(Keycloak\w+).*?(?=^class\s|\z)')) {
    $name = $m.Groups[1].Value
    # type can have nested brackets ([nullable[bool]], [string[]]); match up to the $name on the line
    $props = [regex]::Matches($m.Value, '\[DscProperty[^\]]*\][^\$\r\n]*\$(\w+)') | ForEach-Object { Norm $_.Groups[1].Value }
    $classProps[$name] = @($props)
}

$totalAttr = 0; $totalMissing = 0; $resWithGaps = 0; $missingByRes = @{}
foreach ($rp in $resSchemas) {
    $res = $rp.Name
    $cls = ClassName $res
    $attrs = $rp.Value.block.attributes
    if (-not $attrs) { continue }
    $have = @(if ($classProps.ContainsKey($cls)) { $classProps[$cls] } else { @() })
    $missing = @()
    foreach ($ap in $attrs.PSObject.Properties) {
        $a = $ap.Value
        # non-computed input = optional or required; skip pure computed outputs and 'id'
        # non-portable: Terraform-provider mechanics / computed outputs with no settable
        # Keycloak API equivalent (excluded from the parity denominator).
        if ($ap.Name -in 'id','internal_id','terraform_deletion_protection','import') { continue }
        $isInput = ($a.required -eq $true) -or ($a.optional -eq $true)
        if (-not $isInput) { continue }
        $totalAttr++
        if ((Norm $ap.Name) -notin $have) { $missing += $ap.Name; $totalMissing++ }
    }
    if ($missing.Count) { $resWithGaps++; $missingByRes[$res] = $missing }
}

Write-Host "=== Field parity audit ===" -ForegroundColor Cyan
Write-Host ("resources: {0} | input fields: {1} | present: {2} | MISSING: {3} | parity: {4:P1}" -f `
    $resSchemas.Count, $totalAttr, ($totalAttr-$totalMissing), $totalMissing, (($totalAttr-$totalMissing)/$totalAttr))
Write-Host ("resources with gaps: {0}" -f $resWithGaps)
if ($Detail) {
    $missingByRes.GetEnumerator() | Sort-Object { -$_.Value.Count } | ForEach-Object {
        Write-Host ("  {0,-52} missing {1}: {2}" -f $_.Key, $_.Value.Count, ($_.Value -join ', ')) -ForegroundColor Yellow
    }
}
exit $totalMissing
