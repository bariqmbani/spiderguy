# UX and interaction specification

## Surfaces

Sign-in; workspace switcher; unified input and preview; saved-card list/detail; knowledge/source manager; search results with evidence drawer; email editor; external-action confirmation; members/settings; personal Google connections. Mobile layouts preserve the same explicit actions and keyboard accessibility.

Always show active workspace and private/shared badge. Switching workspace aborts requests and clears cached results, editor source selections, and unsaved generated content after offering to discard or save privately. Never move draft context into the new workspace automatically.

## Input behavior

Six MVP preview types: Note, Checklist, Event, Bookmark, Search, Email. Empty input is neutral. After 350 ms idle, classify. Only the newest sequence may update state. Initial proposed thresholds: below .40 remain neutral; .40–.70 show tentative preview; above .70 select card; close alternatives within .15 show two explicit choices. A challenger needs two consecutive wins or confidence ≥.85 to change a settled preview. Tune these values using fixtures, not visual preference alone.

The manual palette always overrides classification until explicitly released or cleared. Do not allow model updates to overwrite edited structured fields. Search/Email typing merely changes preview; submit Search or Generate explicitly. Enter saves ordinary valid cards; it submits search in Search mode; it never executes a Google action. Shift+Enter inserts newline; Escape closes menus/cancels preview; slash opens palette only outside a multiline field. Announce preview changes through an unobtrusive ARIA live region and support reduced motion.

Jev outage: use keyword classifier, label fallback, retain manual palette. LLM outage: retain edited draft and source selection. Indexing: show status alongside source; search may omit a not-yet-ready source but must say it is pending. No results: offer query revision, not a fabricated answer.

## Structured fields

Note: title/text. Checklist: ordered items and done flags. Event: title/start/end/timezone/location. Bookmark: URL/title/note. Email: explicit recipients/subject/body/tone/citation panel. Validate URLs for display/opening to http/https; never render javascript URLs. Event ambiguity is visible rather than silently resolved. The MVP does not parse arbitrary multi-action instructions into an automatic workflow.

## Action labels and states

“Save card” persists only in the app. “Generate draft” invokes the LLM. “Save to Gmail drafts” prepares and confirms an external action. “Create in Google Calendar” does the same for Calendar. “Share with workspace” is a separate privacy-changing action.

Confirmation displays immutable content, connected Google account, and external destination. Buttons disable while executing; on uncertain outcome explain how to check the external app. Show reconnect status without discarding content. For scope denial, retain copy/export options.

## Sharing generated work

Show a lock and source-dependency reason when private context prevents sharing. Offer to remove private sources and regenerate. Do not silently strip citations and then allow the same private facts to be shared. Source managers show explicit import time and “snapshot” label for Google copies.
