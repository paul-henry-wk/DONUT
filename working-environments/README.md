# Working Environments

## Getting started
Create an environment file named `.env.json`, it will be used by default.

## Advanced configuration
You can create multiple environments with the naming pattern `.env-{name}.json`.

From the GUI: use the **Config** tab to create, clone, and switch environments.

From the CLI:
```
dev\donut.bat -Script commit -EnvFile .env-mydev.json
```

## Schema
See [README.md](../README.md) — Configuration section.
