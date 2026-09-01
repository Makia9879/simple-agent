# Compose deployment

1. Create `secrets/` files: `mysql_password`, `mysql_root_password`, `bootstrap_admin_password`, and PI `pi_models.json`.
2. Run `chmod 600 secrets/*`; `check-secrets.sh` rejects broader permissions.
3. Set a strong bootstrap password (12+ characters), then run `docker compose config` and `docker compose up -d`.
4. Set `TAH_COOKIE_SECURE=false` only for local HTTP. Production must terminate HTTPS and leave it true.

The migration job runs before services. MySQL, Redis, and PI sessions use named volumes. Provider credentials are mounted as a Compose secret and are never command-line arguments. The checked-in tree contains no provider key. `pi_models.json` should use the PI-supported protected credential form and remain mode 0600. First administrator bootstrapping is disabled when username/password inputs are absent.
