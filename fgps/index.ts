import { readFileSync } from "fs";
import type {
  Feature,
  FeatureCollection,
  Position as GeoPosition,
  LineString,
  Polygon,
} from "geojson";
import { Server, Socket } from "net";
import type { GGAPacket } from "nmea-simple";

// Configuration
const PORT = 3006;
const HOST = "0.0.0.0";
const UPDATE_INTERVAL = 1000;
const GPS_FIX_TYPE = "rtk";
const GEOJSON_INPUT_PATH = "./test.geojson";

interface Position {
  latitude: number;
  longitude: number;
  altitude: number;
  satellitesInView: number;
  horizontalDilution: number;
}

// Global state for coordinate tracking
let coordinates: GeoPosition[] = [];
let currentIndex = 0;

function loadGeoJSON(filePath: string): void {
  try {
    const geojsonContent = readFileSync(filePath, "utf8");
    const geojson: FeatureCollection = JSON.parse(geojsonContent);
    coordinates = [];

    geojson.features.forEach((feature: Feature) => {
      if (feature.geometry.type === "LineString") {
        const lineString = feature.geometry as LineString;
        coordinates.push(...lineString.coordinates);
      } else if (feature.geometry.type === "Polygon") {
        const polygon = feature.geometry as Polygon;
        // For polygons, we use the outer ring (first array of coordinates)
        coordinates.push(...polygon.coordinates[0]);
      }
    });

    console.log(`Loaded ${coordinates.length} coordinates from GeoJSON`);
  } catch (error) {
    console.error("Error loading GeoJSON:", error);
    coordinates = [[122.4194, 37.7749]]; // Default coordinates - note longitude comes first in GeoJSON
  }
}

function getNextPosition(): Position {
  if (coordinates.length === 0) {
    return {
      latitude: 37.7749,
      longitude: -122.4194,
      altitude: 10.0,
      satellitesInView: 8,
      horizontalDilution: 1.2,
    };
  }

  const [longitude, latitude] = coordinates[currentIndex] as [number, number];

  // Move to next coordinate, loop back to start if at end
  currentIndex = (currentIndex + 1) % coordinates.length;

  return {
    latitude, // Note: We're correctly assigning latitude/longitude here
    longitude,
    altitude: 10.0 + (Math.random() - 0.5) * 0.1,
    satellitesInView: Math.floor(Math.random() * 4) + 8,
    horizontalDilution: 1.0 + Math.random() * 0.4,
  };
}

function convertToNMEA(
  decimal: number,
  isLat: boolean
): { value: string; direction: string } {
  const absolute = Math.abs(decimal);
  const degrees = Math.floor(absolute);
  const minutes = (absolute - degrees) * 60;

  // Format degrees to 2 digits for lat, 3 for long
  const degreesStr = degrees.toString().padStart(isLat ? 2 : 3, "0");
  // Format minutes to always have 2 decimal places and pad with leading zeros if needed
  const minutesStr = minutes.toFixed(2).padStart(5, "0");

  return {
    value: `${degreesStr}${minutesStr}`,
    direction: isLat ? (decimal >= 0 ? "N" : "S") : decimal >= 0 ? "E" : "W",
  };
}

function formatTime(date: Date): string {
  return (
    date.getUTCHours().toString().padStart(2, "0") +
    date.getUTCMinutes().toString().padStart(2, "0") +
    date.getUTCSeconds().toString().padStart(2, "0") +
    "." +
    date.getUTCMilliseconds().toString().padStart(3, "0")
  );
}

function getFakeGGAData(): GGAPacket {
  const position = getNextPosition();

  return {
    sentenceId: "GGA",
    time: new Date(),
    latitude: position.latitude,
    longitude: position.longitude,
    fixType: GPS_FIX_TYPE,
    satellitesInView: position.satellitesInView,
    horizontalDilution: position.horizontalDilution,
    altitudeMeters: position.altitude,
    geoidalSeperation: -24.7,
    differentialAge: undefined,
    differentialRefStn: undefined,
  };
}

function formatGGAMessage(data: GGAPacket): string {
  const lat = convertToNMEA(data.latitude, true);
  const lon = convertToNMEA(data.longitude, false);

  const fields = [
    "$GPGGA",
    formatTime(data.time),
    lat.value,
    lat.direction,
    lon.value,
    lon.direction,
    data.fixType === "fix" ? "1" : "0",
    data.satellitesInView.toString(),
    data.horizontalDilution.toFixed(1),
    data.altitudeMeters.toFixed(1),
    "M",
    data.geoidalSeperation.toFixed(1),
    "M",
    data.differentialAge?.toString() || "",
    data.differentialRefStn || "",
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
}

function calculateChecksum(message: string): string {
  let checksum = 0;
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
}

// Load coordinates at startup
loadGeoJSON(GEOJSON_INPUT_PATH);

// Create TCP server
const server = new Server();

// Handle client connections
server.on("connection", (socket: Socket) => {
  console.log("Client connected");

  const intervalId = setInterval(() => {
    const ggaData = getFakeGGAData();
    const message = formatGGAMessage(ggaData);
    console.log("GGA EMITTED:", message.trim());
    socket.write(message);
  }, UPDATE_INTERVAL);

  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(intervalId);
  });

  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
    clearInterval(intervalId);
  });
});

server.on("error", (err: Error) => {
  console.error("Server error:", err.message);
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`NMEA GGA simulator running on port ${PORT}`);
  console.log(`GeoJSON path: ${GEOJSON_INPUT_PATH}`);
  console.log(
    `Try connecting with netcat or telnet to any of these addresses:`
  );

  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      if (!net.internal && net.family === "IPv4") {
        console.log(`  ${net.address}:${PORT}`);
      }
    }
  }
  console.log(`  localhost:${PORT}`);
  console.log(`  127.0.0.1:${PORT}`);
});
