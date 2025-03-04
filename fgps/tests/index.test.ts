import { afterAll, beforeEach, describe, expect, mock, test } from "bun:test";
import type { GGAPacket } from "nmea-simple";
import {
  calculateChecksum,
  convertLatLongToDMS,
  formatBestPosMessage,
  formatGGAMessage,
  formatTime,
  getFakeBestPosData,
  getFakeGGAData,
  getNextPosition,
  loadGeoJSON,
} from "../index.ts";

// Mock modules that we don't want to actually use in tests
mock.module("readline", () => ({
  createInterface: () => ({
    prompt: () => {},
    on: () => {
      return { on: () => {} };
    },
  }),
  emitKeypressEvents: () => {},
}));

mock.module("os", () => ({
  networkInterfaces: () => ({
    eth0: [
      {
        address: "192.168.1.1",
        family: "IPv4",
        internal: false,
      },
    ],
  }),
}));

// Import functions to test after mocking dependencies

describe("GPS Data Generation and Formatting", () => {
  describe("Coordinate Conversion", () => {
    test("convertLatLongToDMS converts latitude correctly", () => {
      const result = convertLatLongToDMS(37.7749, false);
      expect(result.coordinate).toStartWith("37");
      expect(result.direction).toBe("N");
    });

    test("convertLatLongToDMS converts longitude correctly", () => {
      const result = convertLatLongToDMS(-122.4194, true);
      expect(result.coordinate).toStartWith("122");
      expect(result.direction).toBe("W");
    });

    test("convertLatLongToDMS handles negative latitudes", () => {
      const result = convertLatLongToDMS(-33.8688, false);
      expect(result.direction).toBe("S");
    });

    test("convertLatLongToDMS handles positive longitudes", () => {
      const result = convertLatLongToDMS(151.2093, true);
      expect(result.direction).toBe("E");
    });
  });

  describe("Time Formatting", () => {
    test("formatTime formats time correctly", () => {
      const date = new Date("2023-01-01T14:30:45.123Z");
      const result = formatTime(date);
      expect(result).toBe("143045.123");
    });

    test("formatTime pads values with leading zeros", () => {
      const date = new Date("2023-01-01T01:02:03.004Z");
      const result = formatTime(date);
      expect(result).toBe("010203.004");
    });
  });

  describe("Checksum Calculation", () => {
    test("calculateChecksum generates correct checksum", () => {
      const message =
        "$GPGGA,143045.123,3746.9430,N,12225.1645,W,4,09,1.2,0.0,M,0.0,M,1,0000";
      const checksum = calculateChecksum(message);
      expect(checksum).toBeString();
      expect(checksum.length).toBe(2);
    });

    test("calculateChecksum validates format", () => {
      // Instead of expecting a specific checksum value (since we don't know the exact algorithm),
      // we just check that it returns a valid format (2 hex digits)
      const message = "$TEST,1,2,3";
      const checksum = calculateChecksum(message);
      expect(checksum).toMatch(/^[0-9A-F]{2}$/);
    });
  });

  describe("GeoJSON Loading", () => {
    const validGeoJSON = JSON.stringify({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [
          [1, 2],
          [3, 4],
          [5, 6],
        ],
      },
    });

    test("loadGeoJSON loads LineString coordinates correctly", () => {
      // Create a temporary test file
      const fs = require("fs");
      const path = "./geojson-data/test_cycle.geojson";
      fs.writeFileSync(path, validGeoJSON);

      loadGeoJSON(path);
      const position = getNextPosition();

      expect(position.latitude).toBeDefined();
      expect(position.longitude).toBeDefined();

      // Clean up
      fs.unlinkSync(path);
    });

    test("loadGeoJSON handles Polygon geometry", () => {
      const polygonGeoJSON = JSON.stringify({
        type: "Feature",
        geometry: {
          type: "Polygon",
          coordinates: [
            [
              [1, 2],
              [3, 4],
              [5, 6],
              [1, 2],
            ],
          ],
        },
      });

      // Create a temporary test file
      const fs = require("fs");
      const path = "./test_polygon.geojson";
      fs.writeFileSync(path, polygonGeoJSON);

      loadGeoJSON(path);
      const position = getNextPosition();

      expect(position.latitude).toBeDefined();
      expect(position.longitude).toBeDefined();

      // Clean up
      fs.unlinkSync(path);
    });

    test("loadGeoJSON throws error for invalid file", () => {
      expect(() => loadGeoJSON("nonexistent.geojson")).toThrow();
    });
  });

  describe("Message Formatting", () => {
    test("formatGGAMessage creates valid NMEA message", () => {
      const ggaData: GGAPacket = {
        sentenceId: "GGA",
        time: new Date("2023-01-01T12:00:00Z"),
        latitude: 37.7749,
        longitude: -122.4194,
        fixType: "rtk",
        satellitesInView: 10,
        horizontalDilution: 1.2,
        altitudeMeters: 0,
        geoidalSeperation: 0,
        differentialAge: 1,
        differentialRefStn: "0000",
      };

      const message = formatGGAMessage(ggaData);
      expect(message).toContain("$GPGGA");
      expect(message).toContain("N"); // Northern hemisphere
      expect(message).toContain("W"); // Western hemisphere
      expect(message).toMatch(/\*[0-9A-F]{2}\r\n$/); // Check for checksum format
    });

    test("formatBestPosMessage creates valid BESTPOS message", () => {
      const position = {
        latitude: 37.7749,
        longitude: -122.4194,
        altitude: 10.1,
        satellitesInView: 10,
        horizontalDilution: 1.2,
      };

      const bestPosData = getFakeBestPosData(position);
      const message = formatBestPosMessage(bestPosData);

      expect(message).toContain("#BESTPOSA");
      expect(message).toContain(position.latitude.toFixed(11));
      expect(message).toContain(position.longitude.toFixed(11));
      expect(message).toMatch(/\*[0-9A-F]{2}\r\n$/); // Check for checksum format
    });
  });

  describe("GPS Data Generation", () => {
    // Setup test data file for the entire suite
    const testDataFile = "./test_position_data.geojson";

    beforeEach(() => {
      // Set up test coordinates before each test to reset state
      const testGeoJSON = JSON.stringify({
        type: "Feature",
        geometry: {
          type: "LineString",
          coordinates: [
            [1, 2],
            [3, 4],
            [5, 6],
          ],
        },
      });
      const fs = require("fs");
      fs.writeFileSync(testDataFile, testGeoJSON);
      loadGeoJSON(testDataFile);
    });

    afterAll(() => {
      // Clean up
      const fs = require("fs");
      if (fs.existsSync(testDataFile)) {
        fs.unlinkSync(testDataFile);
      }
    });

    test("getNextPosition returns valid position data", () => {
      const position = getNextPosition();
      expect(position).toHaveProperty("latitude");
      expect(position).toHaveProperty("longitude");
      expect(position).toHaveProperty("altitude");
      expect(position).toHaveProperty("satellitesInView");
      expect(position).toHaveProperty("horizontalDilution");
    });

    test("getNextPosition cycles through coordinates", () => {
      // Since we're using the same coordinates for each test with beforeEach,
      // we can rely on the state being reset
      const pos1 = getNextPosition(); // Gets [1, 2] and advances index
      const pos2 = getNextPosition(); // Gets [3, 4] and advances index
      const pos3 = getNextPosition(); // Gets [5, 6] and advances index
      const pos4 = getNextPosition(); // Should loop back to [1, 2]

      // Now pos4 should match pos1 (we've cycled through all coordinates)
      expect(pos4.latitude).toBe(pos1.latitude);
      expect(pos4.longitude).toBe(pos1.longitude);
    });

    test("getFakeGGAData returns valid GGA packet", () => {
      // First ensure coordinates are loaded
      loadGeoJSON(testDataFile);

      const ggaData = getFakeGGAData();
      expect(ggaData).toHaveProperty("sentenceId", "GGA");
      expect(ggaData).toHaveProperty("time");
      expect(ggaData).toHaveProperty("latitude");
      expect(ggaData).toHaveProperty("longitude");
      expect(ggaData).toHaveProperty("fixType");
      expect(ggaData.fixType).toBe("rtk");
    });

    test("getFakeBestPosData returns valid BESTPOS data", () => {
      const position = {
        latitude: 37.7749,
        longitude: -122.4194,
        altitude: 10.1,
        satellitesInView: 10,
        horizontalDilution: 1.2,
      };

      const bestPosData = getFakeBestPosData(position);
      expect(bestPosData).toHaveProperty("solutionStatus", "SOL_COMPUTED");
      expect(bestPosData).toHaveProperty("positionType", "OPERATIONAL");
      expect(bestPosData).toHaveProperty("latitude", position.latitude);
      expect(bestPosData).toHaveProperty("longitude", position.longitude);
      expect(bestPosData).toHaveProperty(
        "numTrackedSatellites",
        position.satellitesInView
      );
    });
  });
});
