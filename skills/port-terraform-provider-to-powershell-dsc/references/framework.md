# Framework — the shared layer (build by hand, ~370 lines)

Proven on Keycloak. Rename `Keycloak`→your service. Every fan-out agent copies these
patterns, so get them right once. Two base classes + a factory + a runner.

## Connection base — auth + REST client

```powershell
enum Ensure { Absent; Present }

class KeycloakConnectionBase {
    [DscProperty()] [string] $KcUrl
    [DscProperty()] [string] $AuthRealm = 'master'
    [DscProperty()] [string] $AuthClientId       # worker-app client_credentials ...
    [DscProperty()] [string] $AuthClientSecret
    [DscProperty()] [string] $AccessToken        # ... OR a pre-obtained bearer token

    hidden [string] GetToken() {                 # re-fetch per call; do NOT cache
        if ($this.AccessToken) { return $this.AccessToken }
        (Invoke-RestMethod -Method Post -Uri "$($this.KcUrl)/realms/$($this.AuthRealm)/protocol/openid-connect/token" `
            -Body @{ grant_type='client_credentials'; client_id=$this.AuthClientId; client_secret=$this.AuthClientSecret } `
            -ContentType 'application/x-www-form-urlencoded').access_token
    }
    hidden [object] Api([string]$Method,[string]$Path,[object]$Body) {
        $p = @{ Method=$Method; Uri="$($this.KcUrl)/admin$Path"; Headers=@{ Authorization="Bearer $($this.GetToken())" } }
        if ($null -ne $Body) {
            $isList = ($Body -is [System.Collections.IEnumerable]) -and ($Body -isnot [string]) -and ($Body -isnot [System.Collections.IDictionary])
            $p.Body = if ($isList) { $Body | ConvertTo-Json -Depth 30 -Compress -AsArray } else { ConvertTo-Json $Body -Depth 30 -Compress }
            $p.ContentType = 'application/json'
        }
        return Invoke-RestMethod @p
    }
    hidden [object] ApiGetOrNull([string]$Path) {
        try { return $this.Api('Get',$Path,$null) }
        catch { if ($_.Exception.Response -and [int]$_.Exception.Response.StatusCode -eq 404) { return $null }; throw }
    }
    hidden [void] CopyConnection($t) { foreach ($p in 'KcUrl','AuthRealm','AuthClientId','AuthClientSecret','AccessToken') { $t.$p=$this.$p } }
    # endpoints are keyed by UUID; users write names -> resolve (accept name OR uuid)
    hidden [string] ResolveClientUuid([string]$realm,[string]$clientId) {
        $c = $this.Api('Get',"/realms/$realm/clients?clientId=$clientId",$null); if (@($c).Count -eq 0) { throw "client '$clientId' not found" }; return @($c)[0].id }
    hidden [string] ResolveScopeUuid([string]$realm,[string]$nameOrId) {
        foreach ($s in $this.Api('Get',"/realms/$realm/client-scopes",$null)) { if ($s.id -eq $nameOrId -or $s.name -eq $nameOrId) { return $s.id } }; throw "scope '$nameOrId' not found" }
}
```

## Resource base — the generic collection/{id} engine

Fits most resources (realm-scoped collection: POST to create, GET+filter to read,
PUT/{id}, DELETE/{id}). Subclasses set hooks; `Get/Test/Set` are written once.

```powershell
class KeycloakResourceBase : KeycloakConnectionBase {
    [DscProperty()] [Ensure] $Ensure = [Ensure]::Present
    hidden [string]   CollectionPath() { throw 'abstract' }
    hidden [string]   LookupKeyJson()  { return 'name' }
    hidden [string]   LookupKeyValue() { throw 'abstract' }
    hidden [System.Collections.Specialized.OrderedDictionary] FieldMap() { return [ordered]@{} }  # PascalProp -> camelJson
    hidden [string[]] ListFields()     { return @() }        # order-insensitive compare
    hidden [hashtable] AlwaysBody()    { return @{} }        # sent on create AND update
    hidden [void]     CopyIdentity($t) { }
    hidden [string]   SelfPath($rep)   { return "$($this.CollectionPath())/$($rep.id)" }  # override for name-addressed

    hidden [object] Fetch() {
        $items = $this.ApiGetOrNull($this.CollectionPath()); if ($null -eq $items) { return $null }
        $kj=$this.LookupKeyJson(); $kv=$this.LookupKeyValue()
        foreach ($it in $items) { if ("$($it.$kj)" -eq "$kv") { return $it } }; return $null }
    hidden [bool] ValueMatches($have,$want,[bool]$isList) {
        if ($isList) { return ((@($have)|Sort-Object) -join '|') -eq ((@($want)|Sort-Object) -join '|') }; return "$have" -eq "$want" }
    hidden [bool] FieldsMatch($rep) {
        $lists=$this.ListFields(); foreach ($k in $this.FieldMap().Keys) { $w=$this.$k
            if ($null -eq $w -or ($w -is [string] -and $w -eq '')) { continue }
            if (-not $this.ValueMatches($rep.$($this.FieldMap()[$k]),$w,($this.FieldMap()[$k] -in $lists))) { return $false } }; return $true }
    hidden [hashtable] DesiredBody() {
        $b=@{}; foreach ($e in $this.AlwaysBody().GetEnumerator()) { $b[$e.Key]=$e.Value }
        foreach ($k in $this.FieldMap().Keys) { $w=$this.$k; if ($null -eq $w -or ($w -is [string] -and $w -eq '')) { continue }; $b[$this.FieldMap()[$k]]=$w }; return $b }

    [bool] Test() { $rep=$this.Fetch()
        if ($this.Ensure -eq [Ensure]::Absent) { return ($null -eq $rep) }
        if ($null -eq $rep) { return $false }; return $this.FieldsMatch($rep) }
    [void] Set() { $rep=$this.Fetch()
        if ($this.Ensure -eq [Ensure]::Absent) { if ($null -ne $rep) { $this.Api('Delete',$this.SelfPath($rep),$null) }; return }
        $body=$this.DesiredBody()
        if ($null -eq $rep) { $this.Api('Post',$this.CollectionPath(),$body); return }
        $m=@{}; foreach ($p in $rep.PSObject.Properties) { $m[$p.Name]=$p.Value }; foreach ($e in $body.GetEnumerator()) { $m[$e.Key]=$e.Value }
        $this.Api('Put',$this.SelfPath($rep),$m) }
    [KeycloakResourceBase] Get() {                                   # MUST return the class type
        $o=[Activator]::CreateInstance($this.GetType()); $this.CopyConnection($o); $this.CopyIdentity($o)
        $rep=$this.Fetch(); if ($null -eq $rep) { $o.Ensure=[Ensure]::Absent; return $o }
        $o.Ensure=[Ensure]::Present
        foreach ($k in $this.FieldMap().Keys) { try { $o.$k=$rep.$($this.FieldMap()[$k]) } catch { } }  # tolerate untyped server values
        return $o }
}
```

## A standard resource is then tiny

```powershell
[DscResource()]
class KeycloakRole : KeycloakResourceBase {
    [DscProperty(Key)] [string] $RealmId
    [DscProperty(Key)] [string] $Name
    [DscProperty()]    [string] $Description
    hidden [string] CollectionPath() { return "/realms/$($this.RealmId)/roles" }
    hidden [string] LookupKeyValue() { return $this.Name }
    hidden [System.Collections.Specialized.OrderedDictionary] FieldMap() { return [ordered]@{ Description='description' } }
    hidden [hashtable] AlwaysBody()  { return @{ name = $this.Name } }
    hidden [void] CopyIdentity($t)   { $t.RealmId=$this.RealmId; $t.Name=$this.Name }
    hidden [string] SelfPath($rep)   { return "$($this.CollectionPath())/$($this.Name)" }  # roles: by name
}
```

Relationship resources (group↔role, default-scopes, mappers) extend `ConnectionBase`
directly and write custom `Get/Test/Set` (additive; resolve names→uuids).

## Factory + portable entry point (in the same `.psm1`, after all classes)

```powershell
$script:KeycloakResourceFactory = @{ KeycloakRealm={[KeycloakRealm]::new()}; KeycloakRole={[KeycloakRole]::new()}; <...all...> }
function Invoke-KeycloakResourceItem {
    param([Parameter(Mandatory)][string]$Type,[Parameter(Mandatory)][ValidateSet('Get','Test','Set')][string]$Method,[Parameter(Mandatory)][hashtable]$Property)
    $o = & $script:KeycloakResourceFactory[$Type]
    foreach ($e in $Property.GetEnumerator()) { $o.$($e.Key)=$e.Value }
    switch ($Method) { 'Get'{return $o.Get()} 'Test'{return $o.Test()} 'Set'{$o.Set();return $null} }
}
Export-ModuleMember -Function Invoke-KeycloakResourceItem
```

## Runner (declarative source-of-truth → apply)

A `.ps1` that `Import-PowerShellDataFile`s a `.psd1` (resources keyed by type, NO
secrets), and for each item — connection injected from a `-Connection` param — calls
`Test` then (for `-Method Set`) `Set`, in a declared `$TypeOrder` (realms/keystores/
flows/scopes/clients before mappers/roles/relationships; no auto-graph). Two modes:
`Direct` (calls `Invoke-KeycloakResourceItem`, portable) and `Invoke`
(`Invoke-DscResource`, Windows in-box).
