# Security Specification - Portal de Bloqueo

## Data Invariants
- An ISP must have a valid name, logo, and at least one IP range (if not empty).
- The system configuration (`settings/global`) must define default branding.
- Only admins can modify ISPs and global settings.
- Protected files are publicly readable but only admin-writable.

## Identity & Roles
- **Public**: Can read ISPs and global settings. Can read protected files content.
- **Support Account**: `ticcolcolombia@gmail.com` (verified) is a hardcoded Admin.
- **User Account**: `CYRVOTbehhZoXiyFhERRG6Iyg623` is a hardcoded Admin.
- **Admins**: Can perform all CRUD operations on all collections.

## The "Dirty Dozen" Payloads (Targets for rejection)
1. Creating an ISP with a name longer than 100 characters.
2. Creating an ISP with a logo size exceeding 2MB.
3. Updating an ISP's `id` field.
4. Setting ISP status to an invalid value (e.g., 'deleted').
5. Modifying `settings/global` as a non-admin.
6. Creating an admin record for self without existing admin permission.
7. Injecting 1MB junk string into a document ID.
8. Updating `createdAt` on an existing document.
9. Deleting the `settings/global` document.
10. Creating a protected file with missing mandatory fields.
11. Bypassing `isAdmin` check by spoofing an email (but not verified).
12. Performing a blanket `list` operation on a sensitive collection without filters.

## Eight Pillars Implementation Details
- **Master Gate**: All writes are wrapped in `isAdmin()` which checks for hardcoded UIDs/emails OR existence in `/admins/`.
- **Validation Blueprints**: `isValidISP` and `isValidSystemConfig` helpers used on all create/update.
- **Path Variable Hardening**: `isValidId` applied to ISPs and files.
- **Tiered Identity**: Admins have full access.
- **Total Array Guarding**: `ips` array in ISP checked for size and basic element type.
- **PII Isolation**: No PII stored currently.
- **Atomicity**: Incremental updates to settings use `updatedAt`.
- **Query Enforcer**: Public reads are allowed for ISPs and Settings, no filtering required as they are public information.
