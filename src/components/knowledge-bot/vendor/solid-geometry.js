// A closed surface shared by SVG silhouettes, the wireframe and the OBJ export.
// Input x/y follows the reference image (y down); the mesh uses y up, z forward.
const TAU = Math.PI * 2;

function frontRadius(solid, x, y) {
  const u = ((Math.atan2(y, x) / TAU + 1) % 1) * solid.N;
  const i = Math.floor(u), f = u - i;
  return solid.r[i] + (solid.r[(i + 1) % solid.N] - solid.r[i]) * f;
}

function thickness(solid, x, y, rim) {
  let h2 = 0;
  for (const [cx, cy, rx, ry, rz] of solid.lobes) {
    const dx = (x - cx) / rx, dy = (y - cy) / ry;
    h2 = Math.max(h2, rz * rz * (1 - dx * dx - dy * dy));
  }
  const t2 = (x * x + y * y) / (rim * rim);
  // Round the rim without shrinking the independent crown's central volume.
  return Math.sqrt(h2 * Math.max(0, 1 - t2 ** 4));
}

export function solidSurfacePoint(solid, direction) {
  const [x, y, z] = direction, xy = Math.hypot(x, y);
  if (xy < 1e-10) return [0, 0, Math.sign(z) * thickness(solid, 0, 0, 1)];
  const rim = frontRadius(solid, x, y);
  if (Math.abs(z) < 1e-10) return [x * rim / xy, y * rim / xy, 0];
  let lo = 0, hi = rim / xy;
  // All face points and mesh vertices use this same radial surface, including eyes.
  for (let i = 0; i < 13; i++) {
    const t = (lo + hi) / 2;
    if (Math.abs(z * t) < thickness(solid, x * t, y * t, rim)) lo = t;
    else hi = t;
  }
  return [x * lo, y * lo, z * lo];
}

export function makeSolid(shape, radii) {
  const N = radii.length, k = shape.scale ?? 1;
  const solid = {
    N, r: radii, rings: 24,
    // [cx, cy, rx, ry, rz]; z is symmetric, with a full ellipsoid for each part.
    lobes: shape.solid.lobes.map(([x, y, rx, ry, rz]) =>
      [x * k, -y * k, rx * k, ry * k, rz * k]),
  };
  const vertices = [], faces = [], guides = [];
  const add = (p) => { const id = vertices.length / 3; vertices.push(...p); return id; };
  const rim = Array.from({ length: N }, (_, i) => {
    const a = i / N * TAU;
    return add([Math.cos(a) * radii[i], Math.sin(a) * radii[i], 0]);
  });
  for (const sign of [1, -1]) {
    const pole = add(solidSurfacePoint(solid, [0, 0, sign])), rows = [];
    for (let j = 1; j < solid.rings; j++) {
      const a = j / solid.rings * Math.PI / 2, xy = Math.sin(a), z = sign * Math.cos(a);
      rows.push(Array.from({ length: N }, (_, i) => {
        const t = i / N * TAU;
        return add(solidSurfacePoint(solid, [Math.cos(t) * xy, Math.sin(t) * xy, z]));
      }));
    }
    rows.push(rim);
    const face = (a, b, c) => sign > 0 ? faces.push(a, b, c) : faces.push(a, c, b);
    for (let i = 0; i < N; i++) face(pole, rows[0][i], rows[0][(i + 1) % N]);
    for (let j = 0; j < rows.length - 1; j++) {
      for (let i = 0; i < N; i++) {
        const q = (i + 1) % N, a = rows[j][i], b = rows[j][q], c = rows[j + 1][i], d = rows[j + 1][q];
        // Mirror the diagonal as well as the vertices; otherwise a coarse mesh
        // develops an asymmetric silhouette at 30/45 degrees despite symmetric data.
        if (Math.cos((i + .5) / N * TAU) > 0) { face(a, c, d); face(a, d, b); }
        else { face(a, c, b); face(b, c, d); }
      }
    }
    for (let j = 2; j < rows.length; j += 3) {
      for (let i = 0; i < N; i++) guides.push(rows[j][i], rows[j][(i + 1) % N]);
    }
    for (let i = 0; i < N; i += 16) {
      let prev = pole;
      for (const row of rows) { guides.push(prev, row[i]); prev = row[i]; }
    }
  }
  const V = new Float64Array(vertices), F = new Uint32Array(faces);
  const normals = new Float64Array(F.length), vertexNormals = new Float64Array(V.length), edgeMap = new Map();
  for (let f = 0; f < F.length; f += 3) {
    const a = F[f] * 3, b = F[f + 1] * 3, c = F[f + 2] * 3;
    const ux = V[b] - V[a], uy = V[b + 1] - V[a + 1], uz = V[b + 2] - V[a + 2];
    const vx = V[c] - V[a], vy = V[c + 1] - V[a + 1], vz = V[c + 2] - V[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    normals[f] = nx; normals[f + 1] = ny; normals[f + 2] = nz;
    for (let j = 0; j < 3; j++) {
      const id = F[f + j] * 3;
      vertexNormals[id] += nx; vertexNormals[id + 1] += ny; vertexNormals[id + 2] += nz;
      const e0 = F[f + j], e1 = F[f + (j + 1) % 3], key = Math.min(e0, e1) * (V.length / 3) + Math.max(e0, e1);
      const edge = edgeMap.get(key);
      if (edge) edge.push(f / 3); else edgeMap.set(key, [e0, e1, f / 3]);
    }
  }
  // Every edge has two incident faces: front/back share the exact reference rim.
  const edges = new Uint32Array(edgeMap.size * 4);
  let i = 0;
  for (const edge of edgeMap.values()) {
    if (edge.length !== 4) throw new Error('Solid surface has an open or non-manifold edge');
    edges.set(edge, i); i += 4;
  }
  return Object.assign(solid, { vertices: V, faces: F, normals, vertexNormals, edges,
    guides: new Uint32Array(guides) });
}

export function projectSolid(solid, M, outline = false) {
  const V = solid.vertices, F = solid.normals, E = solid.edges, N = solid.N;
  const out = new Float32Array(N), front = new Uint8Array(F.length / 3), p = new Float64Array(V.length / 3 * 2);
  for (let i = 0, j = 0; i < V.length; i += 3, j += 2) {
    p[j] = M[0] * V[i] + M[1] * V[i + 1] + M[2] * V[i + 2];
    p[j + 1] = M[3] * V[i] + M[4] * V[i + 1] + M[5] * V[i + 2];
  }
  for (let i = 0; i < F.length; i += 3) front[i / 3] = M[6] * F[i] + M[7] * F[i + 1] + M[8] * F[i + 2] >= 0;
  const segments = [], angles = outline ? Array.from({ length: N }, (_, i) => i / N * TAU) : null;
  for (let i = 0; i < E.length; i += 4) {
    if (front[E[i + 2]] === front[E[i + 3]]) continue;
    let a = E[i] * 2, b = E[i + 1] * 2;
    let ax = p[a], ay = p[a + 1], bx = p[b], by = p[b + 1];
    let sweep = Math.atan2(ax * by - ay * bx, ax * bx + ay * by);
    if (sweep < 0) { [ax, bx] = [bx, ax]; [ay, by] = [by, ay]; sweep = -sweep; }
    const angle = (Math.atan2(ay, ax) + TAU) % TAU;
    if (outline) {
      angles.push(angle, (angle + sweep) % TAU);
      segments.push([ax, ay, bx, by, angle, sweep]);
      continue;
    }
    const start = angle * N / TAU;
    const end = start + sweep * N / TAU, ex = bx - ax, ey = by - ay, cross = ax * ey - ay * ex;
    for (let j = Math.ceil(start - 1e-7); j <= Math.floor(end + 1e-7); j++) {
      const id = j % N, t = id / N * TAU, den = Math.cos(t) * ey - Math.sin(t) * ex;
      if (Math.abs(den) < 1e-12) continue;
      const r = cross / den;
      if (r > out[id]) out[id] = r;
    }
  }
  if (outline) {
    angles.sort((a, b) => a - b);
    const unique = angles.filter((a, i) => i === 0 || a - angles[i - 1] > 1e-7);
    if (unique.length > 1 && TAU - unique[unique.length - 1] < 1e-7) unique.pop();
    const radii = new Float64Array(unique.length);
    const cos = Float64Array.from(unique, Math.cos), sin = Float64Array.from(unique, Math.sin);
    const lowerBound = a => {
      let lo = 0, hi = unique.length;
      while (lo < hi) { const m = (lo + hi) >> 1; if (unique[m] < a - 1e-7) lo = m + 1; else hi = m; }
      return lo;
    };
    for (const [ax, ay, bx, by, start, sweep] of segments) {
      const ex = bx - ax, ey = by - ay, cross = ax * ey - ay * ex;
      const hit = (a, b) => {
        for (let i = lowerBound(a); i < unique.length && unique[i] <= b + 1e-7; i++) {
          const den = cos[i] * ey - sin[i] * ex;
          if (Math.abs(den) < 1e-12) continue;
          radii[i] = Math.max(radii[i], cross / den);
        }
      };
      hit(start, Math.min(TAU, start + sweep));
      if (start + sweep >= TAU - 1e-7) hit(0, start + sweep - TAU);
    }
    const points = new Float64Array(unique.length * 2);
    for (let i = 0; i < unique.length; i++) {
      points[2 * i] = cos[i] * radii[i];
      points[2 * i + 1] = sin[i] * radii[i];
    }
    // Preserve actual mesh corners; discard extra radial samples that fall on
    // the very same projected edge. This keeps SVG updates small during spin.
    const keep = [];
    for (let i = 0; i < unique.length; i++) {
      const a = (i - 1 + unique.length) % unique.length, b = (i + 1) % unique.length;
      const ux = points[2*i] - points[2*a], uy = points[2*i+1] - points[2*a+1];
      const vx = points[2*b] - points[2*i], vy = points[2*b+1] - points[2*i+1];
      if (Math.abs(ux*vy-uy*vx) > 1e-9 * (Math.hypot(ux,uy)+Math.hypot(vx,vy))) keep.push(points[2*i],points[2*i+1]);
    }
    return new Float64Array(keep);
  }
  return out;
}

export function solidSurfaceNormal(solid, point) {
  const [x, y, z] = point, r2 = x * x + y * y;
  const u = ((Math.atan2(y, x) / TAU + 1) % 1) * solid.N, i = Math.floor(u), f = u - i;
  const r0 = solid.r[i], r1 = solid.r[(i + 1) % solid.N], rim = r0 + (r1 - r0) * f;
  const dr = (r1 - r0) * solid.N / TAU, s = r2 / (rim * rim), taper = Math.max(0, 1 - s ** 4);
  let h2 = 0, hx = 0, hy = 0;
  for (const [cx, cy, rx, ry, rz] of solid.lobes) {
    const q = rz * rz * (1 - ((x - cx) / rx) ** 2 - ((y - cy) / ry) ** 2);
    if (q > h2) { h2 = q; hx = -2 * rz * rz * (x - cx) / (rx * rx); hy = -2 * rz * rz * (y - cy) / (ry * ry); }
  }
  const tx = -4 * s ** 3 * (2 * x / rim ** 2 + 2 * y * dr / rim ** 3);
  const ty = -4 * s ** 3 * (2 * y / rim ** 2 - 2 * x * dr / rim ** 3);
  return [-hx * taper - h2 * tx, -hy * taper - h2 * ty, 2 * z];
}

export function solidWireframe(solid, M) {
  const V = solid.vertices, normals = solid.vertexNormals, out = [];
  const point = (i) => [M[0] * V[i] + M[1] * V[i + 1] + M[2] * V[i + 2],
    M[3] * V[i] + M[4] * V[i + 1] + M[5] * V[i + 2]];
  for (let i = 0; i < solid.guides.length; i += 2) {
    const a = solid.guides[i] * 3, b = solid.guides[i + 1] * 3;
    const facing = (j) => M[6] * normals[j] + M[7] * normals[j + 1] + M[8] * normals[j + 2];
    if (facing(a) >= 0 && facing(b) >= 0) out.push([point(a), point(b)]);
  }
  return out;
}

export function solidOBJ(solid) {
  const V = solid.vertices, F = solid.faces, lines = ['# Ginger: the same closed mesh rendered in showcase.html', 'o Ginger'];
  for (let i = 0; i < V.length; i += 3) lines.push(`v ${V[i].toFixed(6)} ${V[i + 1].toFixed(6)} ${V[i + 2].toFixed(6)}`);
  for (let i = 0; i < F.length; i += 3) lines.push(`f ${F[i] + 1} ${F[i + 1] + 1} ${F[i + 2] + 1}`);
  return lines.join('\n') + '\n';
}
