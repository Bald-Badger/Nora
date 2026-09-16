# Expiration estimation

Implements spec.md: Expiration and Food Safety.
Prefer dates explicitly supplied by the user or readable on a label. A vague user date is source user with precision approximate. When absent, estimate a calendar expiration date, source ai and precision approximate. Distinguish safety use-by from quality best-by. Leftovers need a practical latest-use date based on food and known storage; do not extend dates to unsafe limits or infer safety from smell or appearance. Clearly expired items must be marked expired. Do not silently turn an expired item available; only an explicit user correction to expiration permits this. Never recommend expired items for consumption.
