---
description: Add a new profile field. Walks through every file that needs updating in the correct order.
---

# Add Profile Field

When adding a new profile field, touch these files in order. Missing any one causes subtle bugs.

The user should provide: field name (snake_case), field type, which roles it applies to, and the options (for enum fields).

## Field types

- **Single-select enum**: dropdown, one value. Goes in `ENUM_SINGLE_FIELDS` in profile-api.js.
- **Multi-select enum**: checkbox grid, array of values. Goes in `ENUM_ARRAY_FIELDS` in profile-api.js.
- **Free text**: plain input or textarea. Goes in `FREE_TEXT_FIELDS` in profile-api.js.
- **Array free text**: pipe/newline/semicolon-separated. Goes in `ARRAY_FREE_TEXT_FIELDS` in profile-api.js.

## Propagation order

### 1. `server/field-registry.js`

For enum fields, add the options to `FIELDS`:
```js
field_name: {
  option_id: 'Display Label',
  // ...
},
```
IDs are snake_case, stable, and used in storage/matching. Labels are display-only.

### 2. `scripts/import.js`

Add the field to the `buildPayload()` function so Google Sheet / CSV import picks it up. Match the field type:
- Single enum: `normalize('field_name', row.field_name)`
- Multi enum: `normalizeArray('field_name', splitMulti(row.field_name))`
- Free text: `row.field_name?.trim() || undefined`

### 3. `client/src/components/ProfileFields.jsx`

- `LABELS`: add the `field_name: { id: 'Label', ... }` mapping (for enum fields)
- `FIELD_NAMES`: add `field_name: 'Display Name'` (for profile rendering)
- `FIELD_ORDER`: add `'field_name'` in the desired display position

### 4. `client/src/components/ApplicationForm.jsx`

Add the field to the appropriate step and role group:

- **Step 1** (basic info / selects):
  - Shared single-select → add to `SHARED_SINGLE` array
  - Mentor-only single-select → add to `MENTOR_SINGLE` array
  - Mentee-only single-select → add to `MENTEE_SINGLE` array
  - Free text → add an `<input>` in the Step 1 JSX
- **Step 2** (multi-selects):
  - Shared multi-select → add to `MULTI_SELECT` array
  - Role-specific topics → add to `TOPIC_FIELDS_MENTOR` or `TOPIC_FIELDS_MENTEE`
- **Step 3** (free text):
  - Add a `<textarea>` or `<input>` in the Step 3 JSX

### 5. `server/profile-api.js`

Add the field name to the correct set:
- `ENUM_SINGLE_FIELDS` — single-select enum
- `ENUM_ARRAY_FIELDS` — multi-select enum
- `FREE_TEXT_FIELDS` — free text
- `ARRAY_FREE_TEXT_FIELDS` — array free text

If the field uses a shared registry key (like `top_strengths` → `topics`), also add it to `ENUM_FIELD_MAP`.

### 6. `scripts/sample-profiles.csv`

Add the column with sample values for at least 2-3 rows. Use IDs for enum fields, not labels.

## After all files

- Run `npm run test:all` to verify nothing broke
- If Google Sheets import is active: `npm run sheet:create -- <sheet-url>` to update headers and dropdowns
- Update `CLAUDE.md` if the field introduces a new pattern or convention
