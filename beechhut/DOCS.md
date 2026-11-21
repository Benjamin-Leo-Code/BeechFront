# BeechHut

An admin console for the house, inside Home Assistant. It shows what needs attention across Unraid, Home Assistant and UniFi, and lets you act on it: restart containers, reboot VMs, install HA updates, restart UniFi devices, toggle lights and more. Press **⌘K** (or `/`) to search and run anything.

Home Assistant itself works automatically: no token is needed. Unraid and UniFi each need an API key.

## Configuration

### Unraid (containers, VMs, array)

1. In Unraid go to **Settings → Management Access → API Keys** and create a key. The *admin* role is simplest. At minimum the key needs read access plus Docker and VM control.
2. Set **Unraid address** to how Home Assistant reaches Unraid, e.g. `http://192.168.1.10`.
3. Paste the key into **Unraid API key**.

This needs Unraid 7.x, which has the API built in. The Unraid API doesn't provide container logs, so those aren't shown. Use the **Unraid Docker** button on the Containers page for them.

### UniFi (network)

1. In UniFi Network go to **Settings → Control Plane → Integrations** and create an API key.
2. Set **UniFi address** to your gateway, e.g. `https://192.168.1.1`, and paste the key.

This needs UniFi Network 9 or later. If you run the UniFi Network Application yourself rather than on a UniFi console, point the address at it. You may also need to set **UniFi API path**.

### Links

Add bookmarks under **Links**. Each one has a name and a URL, plus these optional fields:

| Field | What it does |
| --- | --- |
| `group` | Groups links together on the Links page |
| `icon` | A name from [dashboardicons.com](https://dashboardicons.com) (e.g. `plex`) or an image URL |
| `pinned` | Puts the link in Quick launch on the overview |
| `check` | Set to `false` to skip the up/down check |

Example in YAML mode:

```yaml
links:
  - name: Unraid
    url: http://tower.local
    icon: unraid
    group: Infrastructure
    pinned: true
  - name: Bin collections
    url: https://www.gov.uk/rubbish-collection-day
    group: Household
    check: false
```

### Other options

| Option | What it does |
| --- | --- |
| Favourite containers | Container names to show first in the apps bar at the top of the overview |
| Hidden containers / Hidden entities | Things to leave out. For entities, end with `*` to match a prefix (e.g. `sensor.sun_*`) |
| Home Assistant VM name | The name of this VM in Unraid, so the overview can show it |
| Low battery threshold | Battery sensors at or below this % are flagged |

### House Plan

Scan a room with an iPhone or iPad that has LiDAR, using an app such as Magicplan, Polycam or 3D Scanner App. Export it as **USDZ** (or **GLB**), then use **Upload scan** on the House Plan page. You can keep several plans, for example one per floor plus the garden, and rename or delete them there.

In the viewer, drag to rotate, scroll or pinch to zoom, and right-drag or use two fingers to move. The buttons reset the view, look straight down, cut the walls down to waist height so you can see inside, and go full screen. Tap anything to see what it is (wall, door, window, sofa and so on).

Some apps label their measurements wrongly, which would make the model 10, 100 or 1,000 times too big or too small. BeechHut corrects for this automatically, and shows the plan's overall size under the viewer so you can check it against the real room.

Plans are stored in the add-on's own storage, so they're included in Home Assistant backups and never leave your network.

### Advanced

For anything the Configuration tab doesn't cover, such as overriding a container's link or grouping links in YAML, create `config.yaml` in this add-on's config folder: `/addon_configs/<id>_beechhut/` on the host, which the File editor or Studio Code Server add-on can reach. See `config.example.yaml` in the repository.

## Access and security

- BeechHut only accepts connections through Home Assistant (ingress), so it uses your HA login. If you can reach HA remotely, e.g. through Nabu Casa, you can reach BeechHut too.
- Only Home Assistant **administrators** should see it in the sidebar, because it can stop containers and reboot VMs. Panels for add-ons with ingress are admin-only by default.
- Notes are stored in the add-on's own storage and included in Home Assistant backups.
- Because it runs inside Home Assistant, it's unavailable while HA is down or restarting. Rebooting the Home Assistant VM from the Server page works, but the console will drop out until HA is back.
