# 10 - Security

**Product:** PriceLogic
**Company:** We Solve X Tech
**Document Type:** Security Specification
**Status:** MVP
**Version:** 1.0

---

# 1. Purpose

This document defines the security requirements for PriceLogic.

PriceLogic handles merchant data and can make real pricing changes on Shopify.

Therefore security must prioritize:

```text
Tenant Isolation
+
Authentication
+
Authorization
+
Credential Protection
+
Input Validation
+
Webhook Verification
+
Safe Shopify Mutations
+
Auditability
```

---

# 2. Security Principles

The application must follow:

1. Least privilege
2. Defense in depth
3. Secure by default
4. Explicit authorization
5. Tenant isolation
6. No secrets in frontend
7. No secrets in logs
8. Validate untrusted input
9. Fail safely
10. Keep an audit trail for important actions

---

# 3. Threat Model

Important assets:

* Shopify access credentials
* Merchant/store data
* Product data
* Pricing rules
* Supplier cost data
* Pricing operations
* Price history
* Audit logs

Important threats:

* Unauthorized store access
* Cross-tenant data access
* Unauthorized price changes
* Credential leakage
* Forged webhooks
* Malicious CSV uploads
* API abuse
* Broken authorization
* Replay attacks
* Race conditions
* Injection attacks

---

# 4. Tenant Isolation

Every merchant store is a tenant.

All tenant-owned records must be associated with:

```text
shop_id
```

Application queries must always enforce tenant scope.

Bad:

```text
SELECT * FROM variants
WHERE id = ?
```

Preferred:

```text
SELECT * FROM variants
WHERE id = ?
AND shop_id = ?
```

---

# 5. Cross-Tenant Access

A user connected to Shop A must never access:

* Shop B products
* Shop B variants
* Shop B pricing rules
* Shop B operations
* Shop B supplier records
* Shop B history

This must be enforced server-side.

Never rely only on frontend filtering.

---

# 6. Authorization

Every protected API operation must verify:

```text
Authenticated?
      ↓
Authorized?
      ↓
Correct Shop?
      ↓
Allowed Action?
```

The backend must never trust a `shop_id` supplied by the client without verifying ownership/context.

---

# 7. Authentication

Authentication must be handled through the platform's supported authentication mechanism.

The implementation must:

* Validate sessions
* Expire/revoke invalid sessions
* Protect authenticated endpoints
* Avoid storing unnecessary credentials
* Never expose server-side Shopify credentials to the browser

---

# 8. Shopify Credential Protection

Shopify access credentials are highly sensitive.

Requirements:

* Encrypt at rest where appropriate.
* Never send them to frontend clients.
* Never include them in logs.
* Never include them in error messages.
* Never commit them to source control.
* Never place them in public configuration.

---

# 9. Environment Secrets

Secrets must be stored through environment/secret management.

Examples:

```text
DATABASE_URL
SHOPIFY_CLIENT_SECRET
SESSION_SECRET
ENCRYPTION_KEY
```

Never hard-code secrets.

Never commit `.env` files containing real credentials.

---

# 10. Frontend Security

The frontend must never receive:

* Shopify access tokens
* Encryption keys
* Database credentials
* Internal service credentials
* Private API secrets

The frontend should receive only the minimum data required for the current UI.

---

# 11. API Authorization

Every API endpoint must define:

```text
Who can call it?
What can they access?
What can they change?
```

Example:

```text
POST /pricing-operations/:id/approve
```

must verify:

1. Session
2. Shop ownership
3. Operation ownership
4. Operation state
5. User permission

---

# 12. State-Based Authorization

Authorization must consider operation state.

Example:

```text
DRAFT → APPROVE
```

is valid.

But:

```text
COMPLETED → APPROVE
```

must be rejected.

Security is not only about identity.

It is also about valid state transitions.

---

# 13. Price Mutation Protection

Price updates are high-impact actions.

The system must require:

```text
Valid Operation
+
Correct Shop
+
Approved State
+
Eligible Price Changes
+
Current State Validation
```

before executing a Shopify mutation.

---

# 14. No Client-Controlled Price Execution

The frontend must not be allowed to directly tell the backend:

```text
"Set variant X to $1"
```

without an authorized operation.

Preferred:

```text
Create/Approve Operation
        ↓
Server validates
        ↓
Execution Service
        ↓
Shopify
```

---

# 15. Input Validation

All external input is untrusted.

Validate:

* IDs
* Numbers
* Currency
* Percentages
* Prices
* Dates
* Rule types
* File uploads
* CSV fields
* Search parameters
* Pagination
* Filters

Validation must occur server-side.

---

# 16. Numeric Validation

Reject:

* NaN
* Infinity
* Negative values where invalid
* Excessively large values
* Malformed decimals
* Unexpected numeric strings

Pricing values must use exact decimal handling.

---

# 17. Pricing Rule Validation

Examples:

Percentage:

```text
0% ≤ percentage ≤ configured maximum
```

Target margin:

```text
0% < margin < 100%
```

Protection:

```text
minimum_price <= maximum_price
```

The exact business limits should be configurable.

---

# 18. SQL Injection

Use parameterized queries or the ORM's safe query mechanisms.

Never construct SQL from raw user input.

Bad:

```text
"SELECT * FROM products WHERE title = '" + userInput + "'"
```

Use parameterized queries instead.

---

# 19. XSS Protection

Product titles, vendor names, CSV values, and other merchant-controlled data must be treated as untrusted.

The UI must safely escape/render these values.

Do not inject merchant-controlled HTML directly into the page.

---

# 20. CSRF Protection

State-changing requests must use the appropriate CSRF/session protections required by the chosen authentication architecture.

Do not assume that a browser request is trustworthy simply because it originates from the app UI.

---

# 21. Webhook Security

Shopify webhook authenticity must be verified according to Shopify's current requirements.

Processing flow:

```text
Webhook Request
 ↓
Verify Authenticity
 ↓
Validate Shop
 ↓
Check Idempotency
 ↓
Process
```

Invalid requests must be rejected.

---

# 22. Webhook Replay Protection

Duplicate webhook deliveries must not duplicate side effects.

Maintain sufficient event identity/context to detect already-processed events.

Possible state:

```text
RECEIVED
PROCESSING
PROCESSED
FAILED
```

---

# 23. File Upload Security

Supplier CSV files are untrusted.

Requirements:

* Validate file type.
* Limit file size.
* Limit row count.
* Validate encoding.
* Validate columns.
* Validate values.
* Reject malformed files.
* Never execute uploaded content.

---

# 24. CSV Formula Injection

CSV values can contain spreadsheet formulas.

Imported values must be treated as data.

When exporting/importing data for spreadsheet use, dangerous formula prefixes should be handled appropriately.

Do not blindly render imported CSV values as executable spreadsheet formulas.

---

# 25. Supplier Data Validation

Supplier cost must:

* Be numeric
* Be finite
* Not be negative
* Respect configured precision
* Have a valid currency/context where required

Invalid rows must not silently become valid records.

---

# 26. File Processing Isolation

Large imports should be processed asynchronously.

Flow:

```text
Upload
 ↓
Validate
 ↓
Store Safely
 ↓
Create Import
 ↓
Queue Job
 ↓
Process
 ↓
Delete Temporary File
```

Temporary files should not remain indefinitely.

---

# 27. Rate Limiting

Application APIs should use rate limiting where appropriate.

Especially protect:

* Authentication endpoints
* File uploads
* Search endpoints
* Pricing operation creation
* Pricing operation approval
* Expensive sync endpoints

---

# 28. Abuse Prevention

Prevent a client from repeatedly creating:

```text
10,000 pricing operations
```

for the same store.

Use:

* Rate limits
* Validation
* Operation deduplication
* Queue controls
* Resource limits

---

# 29. Idempotency

High-impact requests should support idempotency where appropriate.

Examples:

* Approving an operation
* Starting execution
* Starting an import
* Creating a campaign
* Executing rollback

A retry should not accidentally perform the action twice.

---

# 30. Race Conditions

Security must account for concurrent requests.

Example:

```text
Request A → Approve
Request B → Approve
```

Only one should succeed.

Likewise:

```text
Worker A → Execute
Worker B → Execute
```

must not produce duplicate Shopify mutations.

Use appropriate database constraints/locking/state transitions.

---

# 31. Audit Logging

Security-sensitive actions must be logged.

Examples:

```text
APP_INSTALLED
APP_UNINSTALLED
RULE_CREATED
RULE_UPDATED
OPERATION_APPROVED
OPERATION_EXECUTED
ROLLBACK_EXECUTED
SHOP_CONNECTION_CHANGED
IMPORT_STARTED
```

---

# 32. Audit Log Safety

Audit logs must not contain:

* Access tokens
* Client secrets
* Passwords
* Encryption keys
* Full sensitive credentials

Metadata should be carefully filtered.

---

# 33. Error Handling

Production errors must not expose internal implementation details.

Avoid returning:

```text
Database connection string
Stack trace
Shopify token
Internal filesystem path
```

to the client.

Instead return a safe error response with an internal correlation ID where useful.

---

# 34. Logging

Logs should support debugging without leaking secrets.

Good:

```text
operation_id=123
shop_id=456
status=FAILED
error_code=SHOPIFY_RATE_LIMITED
```

Bad:

```text
access_token=shpat_xxxxx
```

---

# 35. Correlation IDs

Requests and long-running operations should have traceable identifiers.

Example:

```text
request_id
operation_id
job_id
```

This helps connect:

```text
API Request
 ↓
Database Record
 ↓
Queue Job
 ↓
Shopify Request
 ↓
Result
```

---

# 36. Database Security

Database access must:

* Use strong credentials.
* Use encrypted connections where supported.
* Restrict network access.
* Use least-privileged database users.
* Run migrations through controlled processes.

---

# 37. Backups

Production database backups must exist.

Backups should be:

* Automated
* Encrypted
* Access-controlled
* Tested periodically

A backup that has never been restored is not a proven recovery strategy.

---

# 38. Data Recovery

The application should define recovery procedures for:

* Database failure
* Queue failure
* Shopify outage
* Partial pricing execution
* Failed deployment

Pricing operations must remain recoverable after worker/application restarts.

---

# 39. Dependency Security

Dependencies must be:

* Version controlled
* Regularly updated
* Scanned for known vulnerabilities
* Removed when unnecessary

Do not blindly install packages for trivial functionality.

---

# 40. Production Configuration

Production must disable unnecessary development behavior.

Examples:

* Debug mode
* Verbose error responses
* Development credentials
* Test endpoints
* Unprotected admin routes

---

# 41. Secure Defaults

Default behavior must favor safety.

Examples:

```text
No pricing rule
→ No price change

No approval
→ No execution

Invalid cost
→ No repricing

Invalid webhook
→ Reject

Unknown tenant
→ Reject
```

---

# 42. Principle of Least Privilege

Every component should have only the permissions it needs.

Example:

```text
Pricing Worker
```

should not automatically have permissions unrelated to pricing execution.

---

# 43. Internal Service Boundaries

Services should not trust each other blindly.

For sensitive internal operations:

```text
Caller Identity
+
Operation Authorization
+
Validated Input
```

must be established.

---

# 44. Secret Rotation

The system should support rotation of:

* Application secrets
* Encryption keys where architecture allows
* Shopify credentials when reauthorization occurs

Rotation must not require exposing secrets to application users.

---

# 45. Security Testing

Minimum security testing:

### Authentication

Unauthorized request is rejected.

### Authorization

Shop A cannot access Shop B.

### Pricing Mutation

Unapproved operation cannot update Shopify.

### Webhook

Invalid webhook is rejected.

### File Upload

Malformed/oversized file is rejected.

### Injection

SQL/XSS inputs are safely handled.

### Replay

Duplicate action does not execute twice.

### Concurrency

Two approval/execution requests cannot cause duplicate mutation.

---

# 46. Security Acceptance Criteria

MVP security is acceptable when:

* Tenant isolation is enforced.
* Server-side authorization exists.
* Shopify credentials are protected.
* Webhooks are verified.
* State-changing actions are protected.
* File uploads are validated.
* Pricing inputs are validated.
* Sensitive actions are audited.
* Secrets never appear in logs.
* Rate limits exist for sensitive endpoints.
* Idempotency exists for high-impact operations.
* Production errors do not expose secrets.
* Backup/recovery procedures exist.

---

# 47. Security Priority

Security priorities should be:

```text
P0
Tenant Isolation
Credential Security
Shopify Mutation Authorization
Webhook Verification
Input Validation

P1
Rate Limiting
Advanced Audit
Dependency Scanning
Recovery Automation

P2
Advanced Security Analytics
Enterprise SSO
Advanced Role Management
```

---

# 48. Final Security Principle

PriceLogic controls real merchant pricing.

Therefore:

> **A request that can change money must be treated as a high-trust operation.**

The system should always prefer:

```text
Validate
→ Authorize
→ Preview
→ Approve
→ Execute
→ Verify
→ Audit
```

over:

```text
Request
→ Shopify
```

Security must be part of the architecture, not something added after the MVP is built.
