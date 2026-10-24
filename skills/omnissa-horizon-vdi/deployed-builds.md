# Finding which build a server runs

A task branch of [`omnissa-horizon-vdi`](SKILL.md): load it when the question is what code or config a service on a remote machine is actually running.

## Which build

- **Startup log**: most frameworks log the app version at boot. A Spring Boot service writes `Starting <App> v<version> … (<path to jar>)` and the active profile; find the newest log file in the service's log folder.
- **Version → source**: map the version to a CI pipeline or tag. A common convention is `<semver>-<pipeline id>`; confirm the convention in the deploy job's log before relying on it.
- **Deploy time**: the artifact's modified date in the file browser usually matches the deploy job's finish time to the minute.

## What config it shipped with

A `.jar` is a zip. Ask the user to copy it and rename the copy to `.zip`, then browse it in place: `BOOT-INF/classes/` holds `application.properties` / `application*.yml`. Ask the user to delete the copy afterwards.

The config inside proves the value, not the commit. For byte-level proof that the running artifact is a specific build, compare its hash against the artifact in the repository manager.
