# CNC Copilot FULL 3.0.0

Local-first CNC turning copilot. Version 3.0 combines the server/authentication architecture of the 2.3 branch with the five-step machining workflow, smart tool cupboard, project storage, drawing requirements, adaptive dock and calculation UI from FULL 1.1.2.

## Operating model

- **Local mode is the default.** Core calculations, machine profile, materials, tool cupboard, projects, tolerances, references, print/PDF flow and PWA shell work without API calls.
- **Online functions are explicit.** The user presses the online control before Railway APIs are used.
- **Online mode adds AI recognition and cloud sync.** Tool photos can be sent to the server AI endpoint and local machine/tool/project state can be synchronized to PostgreSQL.
- **Passkey/Face ID is retained.** Online authentication uses the 2.3 WebAuthn server flow. After an online enrollment, the PWA stores the trusted account email, credential IDs and **public** Passkey keys so it can cryptographically verify a fresh WebAuthn assertion offline. Private Passkey keys never leave the authenticator.
- **No automatic cloud dependency.** Losing network connectivity drops the app back to local mode; the CNC workflow remains available.

## Railway variables

Required for the full server mode:

- `DATABASE_URL`
- `APP_ORIGIN` — exact public origin, for example `https://your-app.up.railway.app`
- `RP_ID` — public hostname, for example `your-app.up.railway.app`
- `OPENAI_API_KEY` — only required for AI recognition
- `OPENAI_VISION_MODEL` — optional

Node.js 20+ is required.

## Run

```bash
npm ci
npm start
```

The server migrates `db/schema.sql` at startup and serves the PWA from `public/`.

## Important safety boundary

The calculation engine provides starting machining recommendations. The operator must verify clamping, workholding, tool overhang, collision clearance, spindle/chuck limits, machine state and current manufacturer data before running a program.
