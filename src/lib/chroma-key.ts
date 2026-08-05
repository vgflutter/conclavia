const VERTEX_SHADER = `
  attribute vec2 position;
  varying vec2 textureCoordinate;

  void main() {
    gl_Position = vec4(position, 0.0, 1.0);
    textureCoordinate = vec2(
      (position.x + 1.0) * 0.5,
      1.0 - ((position.y + 1.0) * 0.5)
    );
  }
`;

const FRAGMENT_SHADER = `
  precision mediump float;
  uniform sampler2D videoTexture;
  varying vec2 textureCoordinate;

  void main() {
    vec4 pixel = texture2D(videoTexture, textureCoordinate);
    float competingChannel = max(pixel.r, pixel.b);
    float greenDominance = pixel.g - competingChannel;
    float chroma = smoothstep(0.035, 0.24, greenDominance);
    float litGreen = smoothstep(0.18, 0.52, pixel.g);
    float keyStrength = chroma * litGreen;
    float alpha = 1.0 - keyStrength;

    float spill = max(pixel.g - competingChannel, 0.0) * keyStrength;
    vec3 despilled = vec3(pixel.r, max(pixel.g - spill * 0.78, 0.0), pixel.b);
    gl_FragColor = vec4(despilled * alpha, alpha);
  }
`;

function compileShader(
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error("Unable to create WebGL shader");
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const details = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(details || "Unable to compile WebGL shader");
  }
  return shader;
}

export function startChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): () => void {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: true,
    premultipliedAlpha: true,
  });
  if (!gl) throw new Error("WebGL is not available");

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program) || "Unable to link WebGL program");
  }

  const position = gl.getAttribLocation(program, "position");
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  if (!buffer || !texture) throw new Error("Unable to allocate WebGL resources");

  // Five simultaneous compositing pipelines are enough for the studio view;
  // 640x360 keeps GPU work predictable without changing the rendered size.
  canvas.width = 640;
  canvas.height = 360;
  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0);
  gl.enable(gl.BLEND);
  gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

  let stopped = false;
  let animationFrame: number | undefined;
  let videoFrame: number | undefined;

  const draw = () => {
    if (stopped) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }

    if ("requestVideoFrameCallback" in video) {
      videoFrame = video.requestVideoFrameCallback(draw);
    } else {
      animationFrame = window.requestAnimationFrame(draw);
    }
  };

  draw();

  return () => {
    stopped = true;
    if (animationFrame !== undefined) window.cancelAnimationFrame(animationFrame);
    if (videoFrame !== undefined && "cancelVideoFrameCallback" in video) {
      video.cancelVideoFrameCallback(videoFrame);
    }
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
  };
}
