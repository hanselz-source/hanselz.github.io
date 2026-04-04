# Vaddio Camera API Reverse Engineering

REST API | cURL | JavaScript Analysis | Network Enumeration

## Overview

This project involved reverse-engineering the REST API of a Vaddio AV camera system by analyzing its minified single-page application JavaScript. The goal was to understand the full API surface, authenticate via session cookies, and build tooling to control camera presets and enumerate cameras across the network, all from the command line using `curl`, `grep`, and `python3`.

## What I Built

### 1. API Endpoint Map

Extracted the full REST API structure from minified Backbone.js source code, including nested model relationships and URL construction patterns. Documented every accessible path under `/api/config/`.

### 2. Session Authentication Bypass

Identified that the device uses cookie-based session auth via `/api/config/session` and ships with default credentials (`admin:password`). Built a curl workflow to authenticate and maintain sessions for subsequent API calls.

### 3. Camera Preset Control

Traced the Backbone model hierarchy through the minified JS to find the exact nested API path for preset recall: `/api/config/video/input/0/device/preset`. Built scripts to authenticate and move the camera to any stored preset.

### 4. Network Enumeration Scripts

Wrote Bash and Python scripts to scan subnets for cameras with HTTP on port 80, test default credentials across discovered hosts, and log successes and failures with parallelized requests.

## How It Was Built

### Pulling the JavaScript Source

The Vaddio web interface is a single-page app that loads everything from `app.min.js`. The HTML itself is just a shell with Handlebars templates and no visible API endpoints. To find the real endpoints, I pulled the minified JavaScript directly from the device.

```bash
$ curl -s http://10.105.0.219/app/app.min.js -o app.min.js
```

### Extracting API Endpoints with Grep

Standard grep patterns failed on the minified code because of inconsistent quoting and compressed whitespace. After adjusting the regex, I was able to extract every API path the application references.

```bash
$ grep -oE "['\"]/[a-z_]+(/[a-z_]+)+" app.min.js | sort -u
"/api/config"
"/api/config/account"
"/api/config/led"
"/api/config/network"
"/api/config/session"
"/api/config/stream"
"/api/config/system"
"/api/config/system/eeprom"
"/api/config/system/global_label"
"/api/config/system/product"
"/api/config/system/version"
"/api/config/video"
"/api/realtime/ringbuffer"
"/api/realtime/sockjs"
"/systools/reboot"
"/systools/firmware"
"/systools/diagnostics/download"
```

### Tracing the Room Name Variable

The web UI displays a `room_name` variable via Handlebars. Grepping the JS for `room` revealed how the Backbone model fetches room label data from the API.

```bash
$ grep -oE ".{0,30}room.{0,30}" app.min.js | head -5
t.findWhere({code:"room_name"}),o=t.findWhere({code:"
("company_name").get("value"),room_name:this.collection.get("roo
m_name").get("value"),room_phone:this.collection.get("ro
```

This pointed to `/api/config/system/global_label` as the endpoint that serves room configuration data, containing fields like `room_name`, `company_name`, `room_phone`, and `help_phone`.

### Session Authentication

Attempting to POST directly to a protected endpoint returned a 403: `"anonymous is unauthorized"`. The device uses session cookies, not Basic Auth. Authenticating through the session endpoint with default credentials worked on the first try.

```bash
$ curl -s -c cookies.txt -X POST http://10.105.0.219/api/config/session \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"password"}'
{"last_access":3410228.51,"user_role":"admin","created":3410228.51}
```

### Finding the Preset Recall Path

This was the hardest part. The Backbone.js models use nested URL construction, where child models inherit their parent's URL path. The preset collection lives deep in the hierarchy. I had to trace through multiple layers of model relations in the minified source to discover the full path.

```bash
# Tracing the Backbone model hierarchy
$ grep -oE ".{0,100}collectionType.{0,100}preset.{0,100}" app.min.js
...key:"home_preset",relatedModel:f},{type:"Many",key:"preset",
collectionType:p},{type:"One",key:"state"...

# Exploring the JSON structure
$ curl -s -b cookies.txt http://10.105.0.219/api/config/video/input/0 \
  | python3 -m json.tool | grep -i preset
        "preset_speed": {
        "home_preset": {
        "preset": [
```

After exploring several incorrect paths that returned 404s and "Invalid URL" errors, I discovered the presets live under `/api/config/video/input/0/device/preset`. Each preset contains position data (pan, tilt, zoom) and color correction settings.

```bash
$ curl -s -b cookies.txt http://10.105.0.219/api/config/video/input/0/device/preset \
  | python3 -m json.tool | head -20
[
    {
        "color_correction": {
            "iris": 21,
            "auto_white_balance": true,
            "chroma": 5,
            "detail": 8
        },
        "position": {
            "tilt": 43.18,
            "zoom": 8153,
            "pan": 74.55
        },
        ...
    }
]
```

### Understanding sendAction and sendCommand

The Backbone source revealed that preset recall works through a `sendAction` method that wraps the action name and parameters into a JSON body and POSTs it to the collection URL, not a sub-path. This was the key insight that made the final curl command work.

```javascript
// From the minified JS (reformatted):
sendAction: function(e, t, i) {
    var n = {};
    n[e] = t;                    // builds {"recall": {"id": 1}}
    this.sendCommand(n, i);      // POSTs to collection.url()
}

sendCommand: function(e, t) {
    var i = o.result(this, "url");
    return r.sendCommand(i, e, t);  // POST body to base URL
}
```

### Camera Standby and Control

The first successful recall attempt returned `"In Standby"`, confirming the endpoint was correct but the camera was asleep. Waking it required a PUT to the power endpoint before issuing preset commands.

```bash
# Wake the camera
$ curl -s -b cookies.txt -X PUT \
  http://10.105.0.219/api/config/video/input/0/device/power \
  -H "Content-Type: application/json" \
  -d '{"standby": false}'

# Recall preset 1
$ curl -s -b cookies.txt -X POST \
  http://10.105.0.219/api/config/video/input/0/device/preset \
  -H "Content-Type: application/json" \
  -d '{"recall": {"id": 1}}'
```

## Network Enumeration

### Scanning for HTTP Hosts

With the API mapped on one camera, the next step was finding every camera on the network. I used `nmap` to scan port 80 across the subnet, filtering for hosts serving HTTP but not HTTPS.

```bash
$ nmap -p 80,443 -oG - 10.105.0.0/24 | awk '/80\/open/ && !/443\/open/{print $2}'
```

### Default Credential Testing

I wrote a Bash script to test default credentials against every discovered camera IP, parallelized in batches of 50 for speed. The script logs both successes and failures while ignoring redirects and timeouts.

```bash
#!/bin/bash
i=0
while IFS= read -r ip; do
  (
    status=$(curl -s -o /dev/null -w "%{http_code}" \
      --connect-timeout 2 -u admin:password "http://$ip")
    if [ "$status" -eq 200 ]; then
      echo "$ip - 200 (login success)"
    elif [ "$status" -ne 302 ] && [ "$status" -ne 000 ]; then
      echo "$ip - $status (login failed)"
    fi
  ) &
  i=$((i + 1))
  [ $((i % 50)) -eq 0 ] && wait
done < cameras_ips
wait
```

## API Reference

The full endpoint map discovered through JavaScript analysis:

```
# Configuration endpoints
/api/config/video              Camera, input, output, streaming config
/api/config/system             System info, labels, firmware version
/api/config/system/global_label Room name, company, phone numbers
/api/config/system/product     Device model and hardware info
/api/config/system/version     Firmware version
/api/config/network            Network configuration
/api/config/account            User accounts
/api/config/session            Session auth (POST to login)
/api/config/led                LED indicator settings
/api/config/stream             Streaming configuration

# Camera control (require auth)
/api/config/video/input/0/device/preset       List / recall presets
/api/config/video/input/0/device/power        Standby control

# System tools
/systools/reboot               POST to reboot device
/systools/firmware             Firmware upload
/systools/diagnostics/log      System logs
/systools/diagnostics/download Diagnostic bundle

# Realtime
/api/realtime/sockjs           SockJS websocket for live updates
/api/realtime/ringbuffer       Event ring buffer
```

## Conclusion

What started as a question about how to curl an action button turned into a full reverse-engineering exercise. The Vaddio API is well-structured but completely undocumented from the outside. Every endpoint had to be traced through minified Backbone.js model definitions, nested URL construction patterns, and trial-and-error curl requests.

The biggest takeaway was understanding how Backbone's `sendAction` and `sendCommand` methods translate UI button clicks into REST calls. The nested URL pattern where child models inherit and extend their parent's URL made endpoint discovery non-obvious, since the full path (`/api/config/video/input/0/device/preset`) is never written out anywhere in the source code.

On the network side, the fact that default credentials worked on a production device reinforces why credential rotation and network segmentation matter. A simple Bash one-liner can find every vulnerable camera on a subnet in seconds.

## Tools Used

cURL, Nmap, grep / regex, Python 3, Bash, Backbone.js (analysis), JSON / REST APIs, Vaddio AV
