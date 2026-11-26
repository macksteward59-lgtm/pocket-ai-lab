# Posture exports

Cloud review in this package reads an export an administrator already generated. It does not run MicroBurst, GraphRunner, Burp, ZAP, PowerShell, or any other scan, and it does not send a payload.

The full Microsoft Graph and Azure Resource Manager SDKs are not dependencies. Those SDKs can call write APIs. The optional client below cannot.

## Static review

`reviewPostureText(text, "json" | "csv")` returns findings and `authorized: false`.

JSON is an object with `source` of `graph`, `arm`, or `mixed`, plus any of `applications`, `directoryRoles`, `storageAccounts`, and `roleAssignments`.

CSV header:

```text
recordType,id,name,detail,flag
```

Rows:

| recordType | name | detail | flag |
|---|---|---|---|
| `application` | display name | permission name, such as `Directory.ReadWrite.All` | `present` |
| `directoryRole` | role name, such as `Global Administrator` | member type, such as `servicePrincipal` | `member` |
| `storage` | account name | `allowBlobPublicAccess` or `supportsHttpsTrafficOnly` | `true` or `false` |
| `roleAssignment` | role name, such as `Owner` | scope | `assignment` |

A cell that starts with `=`, `+`, `-`, or `@` is rejected. Code-like text is rejected. The rules report public blob access, non-HTTPS storage, a service principal in a privileged directory role, a short list of high-privilege application permissions, and Owner or User Access Administrator assigned on a whole subscription. Recommendations say what to change. They do not describe an attack.

## Optional read-only GET

`DisabledReadOnlyCloud` is the default and throws. `ReadOnlyCloudClient` runs only when `enabled` is `true`, the base URL is HTTPS, and the path is on the audit allowlist (`organization`, `directoryRoles`, `applications`, `servicePrincipals`, subscription role assignments, and storage accounts). The only method is `get`. `$select` and `$top` (1 through 100) are the only query parameters. The consumer web server does not construct this client.

A token, when the host supplies one, is sent as a bearer header for that request. This module does not read the environment and does not store the token.
