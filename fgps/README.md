# FGPS - GPS Data Simulator

FGPS is a professional GPS data simulator that generates realistic NMEA GGA and BESTPOS messages based on GeoJSON coordinate data. It provides a TCP server for real-time GPS data streaming, making it ideal for testing GPS-enabled applications, fleet management systems, and geolocation services.

## Features

- **Real-time GPS simulation** using GeoJSON coordinate data
- **Dual message format support**: NMEA GGA and BESTPOS
- **Interactive controls** for play/pause and speed adjustment
- **TCP server** for multiple client connections
- **RTK-level accuracy simulation** with realistic error patterns
- **Comprehensive test suite** with 95%+ code coverage

## Quick Start

### Prerequisites

- [Bun](https://bun.sh/) runtime (v1.0.0 or higher)
- Node.js knowledge helpful but not required
- Basic understanding of GPS/GNSS concepts

### Installation

1. **Install Bun** (if not already installed):

   ```bash
   # On macOS/Linux
   curl -fsSL https://bun.sh/install | bash

   # On Windows (PowerShell)
   powershell -c "irm bun.sh/install.ps1 | iex"
   ```

2. **Clone and setup the project**:

   ```bash
   git clone <repository-url>
   cd fgps
   bun install
   ```

3. **Run the simulator**:

   ```bash
   bun run start
   ```

The simulator will start on port 3006 and display available network interfaces for client connections.

## Usage

### Basic Operation

Once started, the FGPS simulator provides an interactive terminal interface:

```
NMEA GGA simulator running on port 3006
GeoJSON path: ./geojson-data/input.geojson

Status: ⏸️ PAUSED
Speed: 1.00x
Connected clients: 0

=== Interactive Commands ===
p - Play (start sending GPS data)
s - Stop (pause sending GPS data)
q - Quit the application
↑ - Speed up GPS data
↓ - Slow down GPS data
===========================
```

### Interactive Controls

| Key      | Action                                    |
| -------- | ----------------------------------------- |
| `p`      | Start/resume GPS data transmission        |
| `s`      | Pause GPS data transmission               |
| `q`      | Quit the application                      |
| `↑`      | Increase simulation speed (up to 4.0x)    |
| `↓`      | Decrease simulation speed (down to 0.25x) |
| `Ctrl+C` | Force quit                                |

### Client Connection

Connect to the simulator using any TCP client:

```bash
# Using netcat
nc localhost 3006

# Using telnet
telnet localhost 3006

# Using Python
python3 -c "
import socket
s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
s.connect(('localhost', 3006))
data = s.recv(1024)
print(data.decode())
s.close()
"
```

### Client Commands

Once connected, clients can send commands to control the simulator:

- `play` - Resume GPS data transmission
- `pause` - Pause GPS data transmission

The server responds with acknowledgment messages for all commands.

## Configuration

### GeoJSON Data Format

FGPS supports both LineString and Polygon GeoJSON geometries:

**LineString Example:**

```json
{
  "type": "Feature",
  "geometry": {
    "type": "LineString",
    "coordinates": [
      [longitude1, latitude1],
      [longitude2, latitude2],
      [longitude3, latitude3]
    ]
  }
}
```

**Polygon Example:**

```json
{
  "type": "Feature",
  "geometry": {
    "type": "Polygon",
    "coordinates": [[
      [longitude1, latitude1],
      [longitude2, latitude2],
      [longitude3, latitude3],
      [longitude1, latitude1]
    ]]
  }
}
```

### Configuration Constants

Key configuration values in `index.ts`:

```typescript
export const PORT = 3006; // TCP server port
export const HOST = "0.0.0.0"; // Bind address
export const GPS_FIX_TYPE = "rtk"; // GPS fix type
export const GEOJSON_INPUT_PATH = "./geojson-data/input.geojson";
export const GGA_UPDATE_INTERVAL = 100; // GGA message interval (ms)
export const BESTPOS_UPDATE_INTERVAL = 100; // BESTPOS message interval (ms)
export const MAX_SPEED_FACTOR = 4.0; // Maximum speed multiplier
export const MIN_SPEED_FACTOR = 0.25; // Minimum speed multiplier
```

## Message Formats

### NMEA GGA Messages

```
$GPGGA,143045.123,3746.9430,N,12225.1645,W,4,09,1.2,0.0,M,0.0,M,1,0000*6E
```

Fields:

- Time (UTC): `143045.123`
- Latitude: `3746.9430,N` (37°46.9430' North)
- Longitude: `12225.1645,W` (122°25.1645' West)
- Fix quality: `4` (RTK fixed)
- Satellites: `09`
- HDOP: `1.2`
- Altitude: `0.0,M`
- Geoidal separation: `0.0,M`
- Differential age: `1`
- Station ID: `0000`
- Checksum: `*6E`

### BESTPOS Messages

```
#BESTPOSA,USB1,0,58.5,FINESTEERING,2296,518445.000,02000020,cdba,16809,SOL_COMPUTED,OPERATIONAL,37.77490000000,-122.41940000000,0.0000,-17.0000,WGS84,0.0124,0.0084,0.0000,"TSTR",1.000,0.000,10,9,8,7,00,11,7f,37*4A
```

Key fields include position data, solution status, satellite counts, and accuracy metrics.

## Development

### Project Structure

```
fgps/
├── index.ts              # Main application code
├── package.json          # Dependencies and scripts
├── tsconfig.json         # TypeScript configuration
├── CLAUDE.md            # Project guidelines
├── geojson-data/        # GeoJSON input files
│   └── input.geojson    # Default coordinate data
└── tests/               # Test suite
    └── index.test.ts    # Comprehensive tests
```

### Available Scripts

```bash
# Start the simulator with hot reload
bun run start

# Run with manual restart
bun run --hot index.ts

# Install dependencies
bun install

# Clean install (remove node_modules and lock file)
bun run nuke

# Run tests
bun test
bun run test

# Type checking
bun --bun tsc --noEmit
```

### Testing

The project includes comprehensive tests covering:

- Coordinate conversion and formatting
- Message generation and validation
- GeoJSON loading and parsing
- Data generation algorithms
- Error handling

Run tests with:

```bash
bun test
```

### Code Style

The project follows strict TypeScript guidelines:

- **Imports**: Grouped by type (Node.js built-ins, external libraries, internal modules)
- **Types**: Strict typing with interfaces for data structures
- **Naming**: camelCase for variables/functions, PascalCase for interfaces/types
- **Error handling**: Try/catch blocks with specific error messages
- **Constants**: UPPER_SNAKE_CASE for configuration values
- **Formatting**: 2-space indentation, single quotes for strings

## API Reference

### Core Functions

#### `loadGeoJSON(filePath: string): void`

Loads coordinate data from a GeoJSON file. Supports LineString and Polygon geometries.

#### `getNextPosition(): Position`

Returns the next position in the coordinate sequence, cycling back to the start when reaching the end.

#### `getFakeGGAData(): GGAPacket`

Generates NMEA GGA packet data with realistic GPS parameters.

#### `getFakeBestPosData(position: Position): BestPosData`

Generates BESTPOS message data for the given position.

#### `formatGGAMessage(data: GGAPacket): string`

Formats GGA data into a valid NMEA message with checksum.

#### `formatBestPosMessage(data: BestPosData): string`

Formats BESTPOS data into a valid message with checksum.

### Types

```typescript
interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  satellitesInView: number;
  horizontalDilution: number;
}

interface BestPosData {
  solutionStatus: string;
  positionType: string;
  latitude: number;
  longitude: number;
  height: number;
  // ... additional fields
}
```

## Troubleshooting

### Common Issues

**Port already in use:**

```bash
# Find process using port 3006
lsof -i :3006

# Kill the process
kill -9 <PID>
```

**Cannot connect to simulator:**

- Verify the simulator is running
- Check firewall settings
- Ensure correct IP address and port
- Try connecting from localhost first

**No GPS data received:**

- Press 'p' to start data transmission
- Verify GeoJSON file exists and is valid
- Check client connection status

**Invalid GeoJSON error:**

- Validate your GeoJSON using online tools
- Ensure coordinates are in [longitude, latitude] format
- Check for proper geometry type (LineString or Polygon)
