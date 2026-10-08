# File formats

Fill in after `npm run m0`. One section per format.

## Template

### `<ext or name>` (magic `____`)

- **Example file:** `fs/...`
- **Count / total size:** from `inventory.md`
- **Purpose:** sprites / map / unit table / ...
- **Compression:** none / LZ10 / LZ11 / custom
- **Confidence:** guess / likely / confirmed
- **Loaded by:** function name from the function map

| offset | type | name | notes |
|---|---|---|---|
| 0x00 | u32 | magic | |

**Decoder:** `extract/src/formats/<name>.ts` (once written)
