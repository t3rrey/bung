// server.ts
import { Server, Socket } from "net";

// Configuration
const PORT = 3006;
const HOST = "0.0.0.0"; // Listen on all available network interfaces
const UPDATE_INTERVAL = 100; // milliseconds

// Types for GGA data
type GGAData = {
  timestamp: string;
  latitude: number;
  latitudeDir: "N" | "S";
  longitude: number;
  longitudeDir: "E" | "W";
  quality: number;
  satellites: number;
  hdop: number;
  altitude: number;
  altitudeUnit: "M";
};

// Initial coordinates (example: starting in San Francisco)
let currentPosition = {
  latitude: 37.7749,
  longitude: -122.4194,
};

// Function to generate timestamp in HHMMSS.SS format
const getTimestamp = (): string => {
  const now = new Date();
  const hours = now.getUTCHours().toString().padStart(2, "0");
  const minutes = now.getUTCMinutes().toString().padStart(2, "0");
  const seconds = now.getUTCSeconds().toString().padStart(2, "0");
  const milliseconds = Math.floor(now.getUTCMilliseconds() / 10)
    .toString()
    .padStart(2, "0");
  return `${hours}${minutes}${seconds}.${milliseconds}`;
};

// Function to simulate movement
const updatePosition = (): void => {
  // Simulate small random movement
  currentPosition.latitude += (Math.random() - 0.5) * 0.0001;
  currentPosition.longitude += (Math.random() - 0.5) * 0.0001;
};

// Function to generate fake GGA data
const getFakeGGAData = (): GGAData => {
  updatePosition();

  return {
    timestamp: getTimestamp(),
    latitude: Math.abs(currentPosition.latitude),
    latitudeDir: currentPosition.latitude >= 0 ? "N" : "S",
    longitude: Math.abs(currentPosition.longitude),
    longitudeDir: currentPosition.longitude >= 0 ? "E" : "W",
    quality: 1, // 1 = GPS fix
    satellites: 8, // Number of satellites in view
    hdop: 1.0, // Horizontal dilution of precision
    altitude: 10.0, // Altitude in meters
    altitudeUnit: "M", // Meters
  };
};

// Function to format GGA message
const formatGGAMessage = (data: GGAData): string => {
  const fields = [
    "$GPGGA",
    data.timestamp,
    data.latitude.toFixed(4),
    data.latitudeDir,
    data.longitude.toFixed(4),
    data.longitudeDir,
    data.quality,
    data.satellites,
    data.hdop.toFixed(1),
    data.altitude.toFixed(1),
    data.altitudeUnit,
  ];

  const message = fields.join(",");
  const checksum = calculateChecksum(message);
  return `${message}*${checksum}\r\n`;
};

// Function to calculate NMEA checksum
const calculateChecksum = (message: string): string => {
  let checksum = 0;
  // Skip the $ at the start
  for (let i = 1; i < message.length; i++) {
    checksum ^= message.charCodeAt(i);
  }
  return checksum.toString(16).toUpperCase().padStart(2, "0");
};

// Create TCP server
const server = new Server();

// Handle client connections
server.on("connection", (socket: Socket) => {
  console.log("Client connected");

  // Set up interval to send GGA messages
  const intervalId = setInterval(() => {
    const ggaData = getFakeGGAData();
    const message = formatGGAMessage(ggaData);
    socket.write(message);
  }, UPDATE_INTERVAL);

  // Handle client disconnect
  socket.on("close", () => {
    console.log("Client disconnected");
    clearInterval(intervalId);
  });

  // Handle errors
  socket.on("error", (err: Error) => {
    console.error("Socket error:", err.message);
    clearInterval(intervalId);
  });
});

// Handle server errors
server.on("error", (err: Error) => {
  console.error("Server error:", err.message);
});

// Start server
server.listen(PORT, HOST, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`Try connecting to any of these addresses:`);

  // Get all network interfaces
  const { networkInterfaces } = require("os");
  const nets = networkInterfaces();

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {
      // Skip internal and non-IPv4 addresses
      if (!net.internal && net.family === "IPv4") {
        console.log(`  http://${net.address}:${PORT}`);
      }
    }
  }
  console.log(`  http://localhost:${PORT}`);
  console.log(`  http://127.0.0.1:${PORT}`);
});
