# ClearLabel API Documentation

ClearLabel uses Next.js route handlers for its public and authenticated API.
Provider keys stay server-side; browser clients call only these application
routes.

## Authentication

Supabase Auth issues the session used by protected routes. User-owned database
rows are additionally protected by row-level security, so route handlers do not
rely on client-provided ownership fields.

Public routes:

- `POST /api/ask`
- `POST /api/scan`
- `POST /api/scan-product`
- `GET /api/health`

Authenticated routes:

- `GET /api/cards`
- `POST /api/cards`
- `DELETE /api/cards/[id]`
- `POST /api/stack-check`
- `POST /api/interactions`

## Endpoints

### `POST /api/ask`

Returns a grounded NIH Office of Dietary Supplements answer.

Request body:

```json
{
  "question": "Can too much vitamin D be harmful?",
  "audience": "simple",
  "language": "en",
  "healthContext": {
    "age": 35,
    "sex": "female",
    "pregnantOrBreastfeeding": false
  }
}
```

Notes:

- Health context is optional and session-only in the UI.
- Retrieval below the measured similarity floor returns a refusal without
  calling the language model.
- Responses include evidence, uncertainty, marketing context, and citations.

### `POST /api/scan`

Transcribes a Supplement Facts panel image into structured supplement and dose
data. This route is public because reading a photo does not touch saved user
data. Saving the result to My Stack requires sign-in.

### `POST /api/scan-product`

Identifies a photographed front label, searches NIH DSLD, and returns the best
manufacturer-submitted product match plus alternates when available.

### `POST /api/stack-check`

Runs the deterministic cumulative-dose checker against the signed-in user's
saved supplement stack. The model does not decide dose safety; the route sums
nutrients and compares them with parsed NIH upper-limit rows.

### `POST /api/interactions`

Checks saved supplements against saved medication names using retrieved NIH
fact-sheet interaction and safety sections. Absence of a mention is reported as
"not mentioned," not as "safe."

### `GET /api/cards`

Lists saved Decision Cards for the signed-in user.

### `POST /api/cards`

Creates a saved Decision Card from a grounded answer and its citations.

### `DELETE /api/cards/[id]`

Deletes a saved Decision Card owned by the signed-in user.

### `GET /api/health`

Checks production readiness without exposing secrets. The deep health path
verifies configured dependencies against real services.

## Environment Variables

Required production variables are documented in [SETUP.md](SETUP.md) and
summarized in [SECURITY_TESTING_COST.md](SECURITY_TESTING_COST.md).

