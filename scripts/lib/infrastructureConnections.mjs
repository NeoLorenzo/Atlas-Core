import { distance } from "@turf/turf";

export const HIGHWAY_CONNECTION_SAMPLE_INTERVAL_KM = 25;
export const RAIL_CONNECTION_SAMPLE_INTERVAL_KM = 25;

function interpolateCoordinates(start, end, t) {
  return [
    start[0] + (end[0] - start[0]) * t,
    start[1] + (end[1] - start[1]) * t,
  ];
}

export function getLineCoordinateArrays(geometry) {
  if (!geometry || typeof geometry !== "object") {
    return [];
  }

  if (geometry.type === "LineString" && Array.isArray(geometry.coordinates)) {
    return [geometry.coordinates];
  }

  if (geometry.type === "MultiLineString" && Array.isArray(geometry.coordinates)) {
    return geometry.coordinates;
  }

  return [];
}

export function densifyLineCoordinates(coordinates, maxIntervalKm) {
  if (!Array.isArray(coordinates) || coordinates.length < 2) {
    return [];
  }

  const sampled = [coordinates[0]];

  for (let index = 1; index < coordinates.length; index += 1) {
    const start = coordinates[index - 1];
    const end = coordinates[index];
    const segmentDistanceKm = distance(start, end, { units: "kilometers" });

    if (!Number.isFinite(segmentDistanceKm) || segmentDistanceKm <= 0) {
      continue;
    }

    const stepCount = Math.max(1, Math.ceil(segmentDistanceKm / maxIntervalKm));
    for (let step = 1; step <= stepCount; step += 1) {
      sampled.push(interpolateCoordinates(start, end, step / stepCount));
    }
  }

  return sampled;
}

export function createConnectionKey(mode, provinceIdA, provinceIdB) {
  const [left, right] = [provinceIdA, provinceIdB].sort();
  return `${mode}::${left}::${right}`;
}

export function addConnectionEdge(edgeMap, edge) {
  const key = createConnectionKey(edge.mode, edge.fromProvinceId, edge.toProvinceId);
  const existing = edgeMap.get(key);

  if (existing) {
    existing.connectionCount += edge.connectionCount;
    existing.approxLengthKm += edge.approxLengthKm;
    return existing;
  }

  edgeMap.set(key, {
    ...edge,
    edgeKey: key,
  });
  return edgeMap.get(key);
}
