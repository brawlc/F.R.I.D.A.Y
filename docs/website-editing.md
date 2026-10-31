# Conversational website editing

In Website Studio, select a saved project and use **Describe a website change**. Example: “Make the colours warm orange, add subtle animations, and improve the mobile menu.” Confirm that the three editable source files may be sent to FRIDAY's configured AI providers. These requests can consume provider credits. Do not keep secrets in frontend source.

1. Generate an edit draft. The saved project stays unchanged.
2. Review the sandboxed draft preview and the three source tabs. The preview blocks network connections and forms; backend integrations are not implemented automatically.
3. Apply all draft files, or discard the draft.
4. Inspect the saved preview or open it in Opera GX. Download source ZIP exports the saved version, not an unapplied draft.

Every new save/apply/restore stores the previous three source files. Choose a restore point and click **Restore snapshot** to undo a change. Restoration first snapshots the current saved state, so it can also be reversed. The UI lists the most recent 30 restore points; older snapshot files are retained. Historical backups created before this feature are not automatically imported into this list.

Unsaved edits must be saved or discarded before requesting AI edits or restoring. Hash checks refuse stale writes when the saved project differs from the version FRIDAY loaded. Reload after external VS Code changes. Snapshots support recovery from normal editing mistakes; multi-file writes are not power-loss-atomic and do not replace independent backups.

The configured generator must return complete valid files. Provider failure does not replace the project with a fallback template. Draft generation is bounded to 150 KB of source and a 4,000-character instruction. Only registered local projects and the three allowlisted files are editable. No paid provider request was used in the regression tests.
