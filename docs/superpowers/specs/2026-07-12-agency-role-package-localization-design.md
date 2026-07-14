# Agency Role Package Localization Design

> Status: Approved for implementation
>
> Date: 2026-07-12

## Objective

Make individually selected Agency roles into immutable, app-owned import
artifacts. Once imported, review, approval, retry, reconciliation, retirement,
and audit must not depend on the source repository remaining at its original
absolute path.

Agency source remains non-runnable. A validated config-backed `RoleContract`
remains the only runtime role authority.

## Package Identity And Layout

Main owns packages below:

```text
<userData>/agency-role-packages/v1/<packageSha256>/
  manifest.json
  draft.json
  source.md        # omitted only for reconstructed legacy records
  LICENSE.txt      # omitted only when unavailable
```

`packageSha256` is SHA-256 over canonical JSON containing schema and importer
versions, source-relative identity, normalized draft hash, and the hashes of
the optional source and license files. Absolute paths and import timestamps do
not participate in identity.

Writes use a sibling temporary directory, verify every persisted hash, and
atomically rename to the final content-addressed directory. Reads verify the
manifest, package identity, and file hashes before returning a package. Package
integrity failure is fail-closed for review and approval.

## Package Contents

The manifest records:

- schema and importer versions;
- package id and import timestamp;
- source-relative path and source SHA-256;
- source division;
- matched runbook slugs;
- license SHA-256 when available;
- completeness: `complete` or `legacy-reconstructed`;
- optional `supersedesPackageId`;
- hashes of `draft.json`, `source.md`, and `LICENSE.txt`.

`draft.json` contains the normalized immutable `AgencyDraftRoleEntry`. Source
prose, division metadata, runbooks, tool hints, and license material remain
review inputs only and cannot grant runtime authority.

## Host Flow

`agencyCatalog({ sourceRoot })` remains a read-only external browser.

New actions:

- `listAgencyPackages()`;
- `importAgencyPackage({ sourceRoot, draftId })`;
- `refreshAgencyPackage({ packageId, sourceRoot })`.

Promotion preview and review accept `packageId` instead of `sourceRoot`.
Approval and retry load the reviewed package locally and verify the reviewed
contract digest. Retirement remains guarded by exact materialized digest.

Import is per role. Re-importing identical content returns the existing
package. Refresh reads the package's source-relative path from an explicitly
selected repository. Changed content creates a new package linked through
`supersedesPackageId`; it never mutates an old package, review, or active role.

## Migration

When the promotion store encounters a record without `packageId`, Main creates
a `legacy-reconstructed` package from the persisted candidate, source
fingerprint, tool dispositions, and review metadata. Original source prose and
license are omitted because they cannot be reconstructed.

The old record is rewritten without `sourceRoot` only after the reconstructed
package has been written and verified. A failed migration leaves the original
record unchanged. Reconstructed records remain approvable after the same
candidate, disposition, and contract-digest validation, while the UI clearly
reports that original prose was not archived.

## UI

The Agency panel exposes an external repository view and a local role library.
The local library loads without a selected repository and owns review,
approval, retry, and retirement. External drafts can be imported individually;
local packages can check for updates through a newly selected repository.

The UI distinguishes complete snapshots, reconstructed snapshots, and newer
versions. It never presents the source draft or package as active.

## Failure Policy

- Missing, corrupt, or unsupported packages cannot be reviewed or approved.
- Failed refresh does not affect the existing package or active role.
- A package digest collision or final-directory mismatch fails closed.
- Store read failure grants no review or runtime authority.
- No package is automatically deleted in v1.

## Non-Goals

- Cross-device package export or import.
- Whole-repository or division bulk import.
- Agency Markdown activation.
- Automatic tool or permission grants.
- Role Memory proposal generation; that is a separate task.

