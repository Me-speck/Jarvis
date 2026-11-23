const vertexShader = `#version 300 es
in vec3 position;
in vec3 corner;
in float illumination;
uniform vec4 camera;
uniform vec2 scale;
out vec3 barycentric;
out float light;
void main() {
  float x = position.x * camera.x - position.y * camera.y;
  float y = position.x * camera.y + position.y * camera.x;
  float depth = y * camera.z - position.z * camera.w;
  float w = 1.0 + depth * 0.3;
  gl_Position = vec4(x * scale.x, (y * camera.w + position.z * camera.z) * scale.y + w * 0.1, depth * 0.4, w);
  barycentric = corner;
  light = illumination;
}`;

const fragmentShader = `#version 300 es
precision highp float;
in vec3 barycentric;
in float light;
uniform bool wireframe;
out vec4 color;
void main() {
  vec3 widths = max(fwidth(barycentric), vec3(0.00001));
  vec3 blend = smoothstep(vec3(0.0), widths * 1.15, barycentric);
  float edge = 1.0 - min(blend.x, min(blend.y, blend.z));
  vec3 surface = mix(vec3(0.035, 0.25, 0.31), vec3(0.10, 0.62, 0.70), light);
  vec3 stroke = vec3(0.40, 0.88, 0.96);
  if (wireframe) {
    if (edge < 0.25) discard;
    color = vec4(stroke, edge);
  } else {
    color = vec4(mix(surface, stroke, edge * 0.30), 1.0);
  }
}`;

function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

export function meshRenderer(host) {
  const canvas = document.createElement("canvas");
  canvas.className = "mesh-overlay";
  canvas.setAttribute("aria-hidden", "true");
  const gl = canvas.getContext("webgl2", { alpha: true, antialias: true });
  if (!gl) return null;
  const program = gl.createProgram();
  try {
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, vertexShader));
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, fragmentShader));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
  } catch {
    return null;
  }
  gl.useProgram(program);
  const vertices = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, vertices);
  for (const [name, size, offset] of [["position", 3, 0], ["corner", 3, 12], ["illumination", 1, 24]]) {
    const location = gl.getAttribLocation(program, name);
    gl.enableVertexAttribArray(location);
    gl.vertexAttribPointer(location, size, gl.FLOAT, false, 28, offset);
  }
  const camera = gl.getUniformLocation(program, "camera");
  const scale = gl.getUniformLocation(program, "scale");
  const wireframe = gl.getUniformLocation(program, "wireframe");
  let count = 0;
  host.after(canvas);
  return {
    setMesh(mesh, center, radius, lightAt) {
      count = mesh.length / 3;
      const data = new Float32Array(count * 7);
      for (let i = 0; i < mesh.length; i += 9) {
        const light = lightAt(mesh, i);
        for (let vertex = 0; vertex < 3; vertex++) {
          const offset = (i / 3 + vertex) * 7;
          for (let axis = 0; axis < 3; axis++) {
            data[offset + axis] = (mesh[i + vertex * 3 + axis] - center[axis]) / radius;
          }
          data[offset + 3 + vertex] = 1;
          data[offset + 6] = light;
        }
      }
      gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
    },
    render(params) {
      const { width, height, dpr, c, s, cp, sp, size, outline } = params;
      if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
        canvas.width = Math.round(width * dpr);
        canvas.height = Math.round(height * dpr);
      }
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      gl.uniform4f(camera, c, s, cp, sp);
      gl.uniform2f(scale, 2 * size / width, 2 * size / height);
      gl.uniform1i(wireframe, Number(outline));
      gl.drawArrays(gl.TRIANGLES, 0, count);
    },
  };
}
