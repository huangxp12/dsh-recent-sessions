# Changelog

## 0.1.0 — first public release

- **Recent sessions panel** (global panel, not tied to any session): every session across every workspace, newest first, including sessions the sidebar is currently hiding (collapsed workspaces, unregistered directories).
- Each row carries its workspace as a **clickable filter chip**, a status dot, pin state, and a second line with that session's **last human prompt** (hover for the last assistant reply preview, read from the host `turnOutline` projection).
- **Time grouping** (Today / Yesterday / This week / Earlier) and two sort orders: most recent, or **least recently touched** (time buckets flip too). Filters: only unfinished / include blank / include subagent sessions; archived hidden by default. View state is remembered locally.
- **Find it again**: full-text search over message content (host index) plus instant local title/path filtering; per-row actions to open the session, **reveal its workspace folder in the file manager**, and copy the path.
- **Deferred thoughts**: jot a line on any row (stored locally, never sent). When you reopen that session a one-line strip appears above the composer — insert it into the draft (official, undoable editor insertion), silence it until something new arrives, or discard it.
- Open the panel in its own same-origin window.
- **Zero writes to your conversations**: the host half is an empty `apply`; notes, thoughts and view state live in `localStorage` only.
