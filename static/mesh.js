import { meshRenderer } from "./mesh-renderer.js";

const MAX_TRIANGLES = 120000;

export function beamMesh(length, width, height) {
  const points = [
    [0, 0, 0], [length, 0, 0], [length, width, 0], [0, width, 0],
    [0, 0, height], [length, 0, height], [length, width, height], [0, width, height],
  ];
  const faces = [[3, 2, 1, 0], [4, 5, 6, 7], [0, 1, 5, 4], [1, 2, 6, 5], [2, 3, 7, 6], [3, 0, 4, 7]];
  return Float32Array.from(faces.flatMap(([a, b, c, d]) => [a, b, c, a, c, d].flatMap(i => points[i])));
}

export function radialMesh(bottomDiameter, topDiameter, height, boreDiameter, segments) {
  const ring = (diameter, z) => Array.from({ length: segments }, (_, index) => {
    const angle = 2 * Math.PI * index / segments;
    return [diameter / 2 * Math.cos(angle), diameter / 2 * Math.sin(angle), z];
  });
  const bottom = ring(bottomDiameter, 0);
  const top = ring(topDiameter, height);
  const insideBottom = boreDiameter ? ring(boreDiameter, 0) : null;
  const insideTop = boreDiameter ? ring(boreDiameter, height) : null;
  const lowerCenter = [0, 0, 0];
  const upperCenter = [0, 0, height];
  const mesh = [];
  const triangle = (a, b, c) => mesh.push(...a, ...b, ...c);
  const quad = (a, b, c, d) => {
    triangle(a, b, c);
    triangle(a, c, d);
  };
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    quad(bottom[i], bottom[j], top[j], top[i]);
    if (insideBottom) {
      quad(insideBottom[j], insideBottom[i], insideTop[i], insideTop[j]);
      quad(top[i], top[j], insideTop[j], insideTop[i]);
      quad(bottom[j], bottom[i], insideBottom[i], insideBottom[j]);
    } else {
      triangle(lowerCenter, bottom[j], bottom[i]);
      triangle(upperCenter, top[i], top[j]);
    }
  }
  return Float32Array.from(mesh);
}

function normal(mesh, i) {
  const [ax, ay, az] = [mesh[i + 3] - mesh[i], mesh[i + 4] - mesh[i + 1], mesh[i + 5] - mesh[i + 2]];
  const [bx, by, bz] = [mesh[i + 6] - mesh[i], mesh[i + 7] - mesh[i + 1], mesh[i + 8] - mesh[i + 2]];
  return [ay * bz - az * by, az * bx - ax * bz, ax * by - ay * bx];
}

function illumination(mesh, i) {
  const [nx, ny, nz] = normal(mesh, i);
  const magnitude = Math.hypot(nx, ny, nz) || 1;
  return Math.abs((-nx * 0.35 - ny * 0.3 + nz * 0.85) / magnitude);
}

export function inspectMesh(mesh) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  let area = 0;
  let degenerate = 0;
  let signedVolume = 0;
  const edges = new Map();
  for (let i = 0; i < mesh.length; i += 9) {
    for (let v = i; v < i + 9; v += 3) {
      for (let axis = 0; axis < 3; axis++) {
        const coordinate = mesh[v + axis];
        if (!Number.isFinite(coordinate) || Math.abs(coordinate) > 1e8) {
          throw new Error("Mesh coordinates are invalid or out of range.");
        }
        min[axis] = Math.min(min[axis], coordinate);
        max[axis] = Math.max(max[axis], coordinate);
      }
    }
    const cross = normal(mesh, i);
    const faceArea = Math.hypot(...cross) / 2;
    if (!faceArea) {
      degenerate++;
      continue;
    }
    area += faceArea;
    signedVolume += (
      (mesh[i] - mesh[0]) * cross[0] +
      (mesh[i + 1] - mesh[1]) * cross[1] +
      (mesh[i + 2] - mesh[2]) * cross[2]
    ) / 6;
    const vertices = [i, i + 3, i + 6].map(offset => mesh.subarray(offset, offset + 3).join(","));
    for (let edge = 0; edge < 3; edge++) {
      const start = vertices[edge];
      const end = vertices[(edge + 1) % 3];
      const key = start < end ? start + ";" + end : end + ";" + start;
      const record = edges.get(key);
      const direction = start < end ? 1 : -1;
      if (record) {
        record.count++;
        record.balance += direction;
      } else {
        edges.set(key, { count: 1, balance: direction });
      }
    }
  }
  if (!area) throw new Error("This STL contains no triangles with surface area.");
  let boundary = 0;
  let nonManifold = 0;
  let winding = 0;
  for (const { count, balance } of edges.values()) {
    if (count === 1) boundary++;
    if (count > 2) nonManifold++;
    if (count === 2 && balance !== 0) winding++;
  }
  const volume = boundary || nonManifold || degenerate || winding ? null : Math.abs(signedVolume);
  return {
    min, max, area, size: max.map((value, i) => value - min[i]), count: mesh.length / 9,
    boundary, nonManifold, degenerate, winding, volume, inward: volume !== null && signedVolume < 0,
  };
}

export function readSTL(buffer) {
  const data = new DataView(buffer);
  const count = data.byteLength >= 84 ? data.getUint32(80, true) : 0;
  if (count && data.byteLength === 84 + count * 50) {
    if (count > MAX_TRIANGLES) throw new Error("Open an STL with at most 120,000 triangles.");
    const mesh = new Float32Array(count * 9);
    for (let face = 0; face < count; face++) {
      for (let j = 0; j < 9; j++) mesh[face * 9 + j] = data.getFloat32(96 + face * 50 + j * 4, true);
    }
    return mesh;
  }

  const text = new TextDecoder().decode(buffer).trim();
  if (!/^solid(?:\s|$)/i.test(text) || !/^\s*endsolid(?:\s|$)/im.test(text)) {
    throw new Error("This file is not a supported binary or ASCII STL.");
  }
  const mesh = [];
  let vertices = 0;
  let inFacet = false;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (/^facet\s+normal\b/i.test(line)) {
      if (inFacet) throw new Error("The STL contains an incomplete facet.");
      inFacet = true;
      vertices = 0;
    } else if (/^vertex\b/i.test(line)) {
      const coordinates = line.split(/\s+/).slice(1);
      if (!inFacet || vertices === 3 || coordinates.length !== 3) throw new Error("Invalid STL vertex.");
      mesh.push(...coordinates.map(Number));
      vertices++;
      if (mesh.length > MAX_TRIANGLES * 9) throw new Error("Open an STL with at most 120,000 triangles.");
    } else if (/^endfacet$/i.test(line)) {
      if (!inFacet || vertices !== 3) throw new Error("Invalid STL facet.");
      inFacet = false;
    }
  }
  if (inFacet || !mesh.length) throw new Error("The STL contains incomplete or missing facets.");
  return Float32Array.from(mesh);
}

export function writeSTL(mesh) {
  const buffer = new ArrayBuffer(84 + mesh.length / 9 * 50);
  const data = new DataView(buffer);
  data.setUint32(80, mesh.length / 9, true);
  for (let face = 0; face < mesh.length / 9; face++) {
    const offset = 84 + face * 50;
    const vector = normal(mesh, face * 9);
    const norm = Math.hypot(...vector) || 1;
    vector.forEach((value, i) => data.setFloat32(offset + i * 4, value / norm, true));
    for (let i = 0; i < 9; i++) data.setFloat32(offset + 12 + i * 4, mesh[face * 9 + i], true);
  }
  return buffer;
}

export class Viewport {
  constructor(canvas) {
    this.canvas = canvas;
    this.context = canvas.getContext("2d");
    this.renderer = meshRenderer(canvas);
    this.wireframe = false;
    this.frame = null;
    this.reset();
    new ResizeObserver(() => this.invalidate()).observe(canvas);

    let last;
    canvas.addEventListener("pointerdown", event => {
      if (event.button !== 0 || last) return;
      canvas.setPointerCapture(event.pointerId);
      last = event;
    });
    canvas.addEventListener("pointermove", event => {
      if (!last || last.pointerId !== event.pointerId) return;
      this.orbit((event.clientX - last.clientX) * 0.012, (event.clientY - last.clientY) * 0.012);
      last = event;
    });
    canvas.addEventListener("lostpointercapture", () => { last = null; });
    canvas.addEventListener("wheel", event => {
      event.preventDefault();
      this.magnify(event.deltaY > 0 ? 0.9 : 1.1);
    }, { passive: false });
    canvas.addEventListener("keydown", event => {
      const controls = {
        ArrowLeft: () => this.orbit(-0.15, 0), ArrowRight: () => this.orbit(0.15, 0),
        ArrowUp: () => this.orbit(0, -0.15), ArrowDown: () => this.orbit(0, 0.15),
        "+": () => this.magnify(1.12), "=": () => this.magnify(1.12), "-": () => this.magnify(0.88),
      };
      if (!Object.hasOwn(controls, event.key)) return;
      event.preventDefault();
      controls[event.key]();
    });
  }

  setMesh(mesh, stats, closed) {
    this.mesh = mesh;
    this.stats = stats;
    this.center = stats.max.map((value, i) => (value + stats.min[i]) / 2);
    this.radius = Math.max(...stats.size);
    this.closed = closed;
    this.renderer?.setMesh(mesh, this.center, this.radius, illumination);
    this.reset();
  }

  reset() {
    this.yaw = -0.58;
    this.pitch = 0.63;
    this.zoom = 1;
    this.invalidate();
  }

  orbit(x, y) {
    this.yaw += x;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch + y));
    this.invalidate();
  }

  magnify(factor) {
    this.zoom = Math.max(0.35, Math.min(3, this.zoom * factor));
    this.invalidate();
  }

  invalidate() {
    if (this.frame !== null) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = null;
      this.render();
    });
  }

  render() {
    const { canvas, context: ctx, mesh, radius, stats } = this;
    if (!mesh || !ctx || !canvas.clientWidth || !canvas.clientHeight) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = Math.min(devicePixelRatio, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const c = Math.cos(this.yaw), s = Math.sin(this.yaw);
    const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
    const scale = Math.min(width * 0.70, height * 0.92) * this.zoom;
    const project = (x, y, z) => {
      const u = x * c - y * s;
      const v = x * s + y * c;
      const depth = v * cp - z * sp;
      const perspective = 1 / (1 + depth * 0.3);
      return [width * 0.5 + u * scale * perspective, height * 0.45 - (v * sp + z * cp) * scale * perspective, depth];
    };
    const floor = -stats.size[2] / (2 * radius) - 0.08;
    ctx.strokeStyle = "#437a8d55";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = -8; i <= 8; i++) {
      const step = i / 8;
      const [a, b, d, e] = [project(step, -1, floor), project(step, 1, floor), project(-1, step, floor), project(1, step, floor)];
      ctx.moveTo(a[0], a[1]); ctx.lineTo(b[0], b[1]);
      ctx.moveTo(d[0], d[1]); ctx.lineTo(e[0], e[1]);
    }
    ctx.stroke();
    if (this.renderer) {
      this.renderer.render({ width, height, dpr, c, s, cp, sp, size: scale, outline: this.wireframe });
      return;
    }
    const vertex = i => project(
      (mesh[i] - this.center[0]) / radius,
      (mesh[i + 1] - this.center[1]) / radius,
      (mesh[i + 2] - this.center[2]) / radius
    );
    const faces = [];
    const stride = Math.max(1, Math.ceil(stats.count / 10000));
    for (let i = 0; i < mesh.length; i += 9 * stride) {
      const points = [vertex(i), vertex(i + 3), vertex(i + 6)];
      const [a, b, d] = points;
      const signedArea = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
      if (this.closed && !this.wireframe && signedArea >= 0) continue;
      faces.push({ points, depth: a[2] + b[2] + d[2], light: illumination(mesh, i) });
    }
    faces.sort((a, b) => b.depth - a.depth);
    ctx.lineWidth = 0.75;
    ctx.strokeStyle = this.wireframe ? "#64d9edbb" : "#79e4f281";
    for (const { points, light } of faces) {
      ctx.beginPath();
      ctx.moveTo(points[0][0], points[0][1]);
      ctx.lineTo(points[1][0], points[1][1]);
      ctx.lineTo(points[2][0], points[2][1]);
      ctx.closePath();
      if (!this.wireframe) {
        ctx.fillStyle = `hsl(189 58% ${21 + light * 28}%)`;
        ctx.fill();
      }
      ctx.stroke();
    }
  }
}
