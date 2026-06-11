# Security Specification - TICCOL ISP Portal

## Data Invariants
1. **ISP Records**:
   - Must have `name` (string, max 100 chars).
   - Must have `logo` (string, max 2MB for data URLs).
   - Must have `ips` (list of strings).
   - `activationType` must be one of: `default`, `indefinite`, `monthly`.
   - `status` must be one of: `active`, `suspended`.
   - `updatedAt` must be a server timestamp.
2. **System Config**:
   - `defaultName` (string).
   - `defaultLogo` (string).
   - `protectedFiles` (list of objects with `id`, `title`, `content`).

## The Dirty Dozen Payloads (Target: DENY)
1. **Unauthenticated Write**: Any write to `isps` or `settings` without auth.
2. **Ghost Field Injection**: Adding `isVerified: true` to an ISP document.
3. **Identity Spoofing**: Trying to set `createdBy` to another user's UID.
4. **Invalid Type**: Setting `ips` to a string instead of a list.
5. **Giant String**: Setting `name` to a 1MB string.
6. **Invalid Enum**: Setting `status` to `deleted` (not in enum).
7. **Malformed ID**: Creating a document with ID `../../etc/passwd`.
8. **Bypassing App Logic**: Deleting a `default` activation ISP (if we want to enforce this in rules).
9. **PII Leak**: Reading `users` collection (if it existed, but we don't have one).
10. **State Shortcut**: Setting `status` directly to `active` without satisfying conditions (if any).
11. **Orphaned Write**: Creating an ISP with a non-existent ASN (if we validated ASN).
12. **Timestamp Fraud**: Providing a manual client timestamp for `updatedAt`.

## Test Environments
- `firestore.rules.test.ts` will verify these cases.
