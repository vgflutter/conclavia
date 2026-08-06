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

const KEY_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D videoTexture;
  uniform sampler2D previousTexture;
  uniform vec2 texelSize;
  uniform float historyStrength;
  varying vec2 textureCoordinate;

  float greenDominance(vec3 color) {
    float competingChannel = max(color.r, color.b);
    float saturationGuard = smoothstep(0.12, 0.48, color.g);
    return max(color.g - competingChannel, 0.0) * saturationGuard;
  }

  void main() {
    vec2 uv = textureCoordinate;
    vec4 pixel = texture2D(videoTexture, uv);
    float center = greenDominance(pixel.rgb);
    float neighbourhood = (
      greenDominance(texture2D(videoTexture, uv + vec2(texelSize.x, 0.0)).rgb) +
      greenDominance(texture2D(videoTexture, uv - vec2(texelSize.x, 0.0)).rgb) +
      greenDominance(texture2D(videoTexture, uv + vec2(0.0, texelSize.y)).rgb) +
      greenDominance(texture2D(videoTexture, uv - vec2(0.0, texelSize.y)).rgb)
    ) * 0.25;

    // Neighbour sampling removes single-pixel green noise while preserving hair.
    float matteSignal = mix(center, neighbourhood, 0.34);
    float background = smoothstep(0.035, 0.225, matteSignal);
    float alpha = 1.0 - background;

    // Reuse a small amount of the previous matte only around semi-transparent
    // edges. Solid foreground and solid background remain frame-accurate.
    vec4 previous = texture2D(previousTexture, uv);
    float edgeWeight = 1.0 - abs(alpha * 2.0 - 1.0);
    alpha = mix(alpha, previous.a, historyStrength * edgeWeight);

    float competingChannel = max(pixel.r, pixel.b);
    float spill = max(pixel.g - competingChannel, 0.0);
    float spillWeight = (1.0 - alpha) + edgeWeight * 0.42;
    float neutralGreen = (pixel.r + pixel.b) * 0.5;
    vec3 clean = pixel.rgb;
    clean.g = mix(clean.g, min(clean.g, neutralGreen * 1.08), clamp(spill * 4.0 * spillWeight, 0.0, 1.0));

    // A restrained warm broadcast grade compensates for the cool green-screen
    // capture without changing skin identity or clipping highlights.
    clean.r = min(clean.r * 1.018 + 0.002, 1.0);
    clean.g = min(clean.g * 1.002, 1.0);
    clean.b = min(clean.b * 0.986, 1.0);

    gl_FragColor = vec4(clean * alpha, alpha);
  }
`;

const COPY_FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D frameTexture;
  varying vec2 textureCoordinate;

  void main() {
    gl_FragColor = texture2D(frameTexture, textureCoordinate);
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

function createProgram(
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error("Unable to create WebGL program");
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const details = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(details || "Unable to link WebGL program");
  }
  return program;
}

function configureTexture(gl: WebGLRenderingContext, texture: WebGLTexture) {
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
}

function allocateTexture(
  gl: WebGLRenderingContext,
  texture: WebGLTexture,
  width: number,
  height: number,
) {
  configureTexture(gl, texture);
  gl.texImage2D(
    gl.TEXTURE_2D,
    0,
    gl.RGBA,
    width,
    height,
    0,
    gl.RGBA,
    gl.UNSIGNED_BYTE,
    null,
  );
}

function bindQuad(
  gl: WebGLRenderingContext,
  program: WebGLProgram,
  buffer: WebGLBuffer,
) {
  const position = gl.getAttribLocation(program, "position");
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
}

export interface ChromaKeyPipeline {
  resize: (width: number, height: number) => void;
  stop: () => void;
}

export function startChromaKey(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement,
): ChromaKeyPipeline {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    preserveDrawingBuffer: false,
  });
  if (!gl) throw new Error("WebGL is not available");

  const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER);
  const keyFragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    KEY_FRAGMENT_SHADER,
  );
  const copyFragmentShader = compileShader(
    gl,
    gl.FRAGMENT_SHADER,
    COPY_FRAGMENT_SHADER,
  );
  const keyProgram = createProgram(gl, vertexShader, keyFragmentShader);
  const copyProgram = createProgram(gl, vertexShader, copyFragmentShader);
  const buffer = gl.createBuffer();
  const videoTexture = gl.createTexture();
  const historyTextures = [gl.createTexture(), gl.createTexture()];
  const framebuffer = gl.createFramebuffer();
  if (
    !buffer ||
    !videoTexture ||
    !historyTextures[0] ||
    !historyTextures[1] ||
    !framebuffer
  ) {
    throw new Error("Unable to allocate WebGL resources");
  }

  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  configureTexture(gl, videoTexture);

  let width = 640;
  let height = 360;
  let previousIndex = 0;
  let hasHistory = false;

  const resizeBuffers = (nextWidth: number, nextHeight: number) => {
    width = Math.max(320, Math.round(nextWidth));
    height = Math.max(180, Math.round(nextHeight));
    canvas.width = width;
    canvas.height = height;
    allocateTexture(gl, historyTextures[0], width, height);
    allocateTexture(gl, historyTextures[1], width, height);
    previousIndex = 0;
    hasHistory = false;
  };
  resizeBuffers(width, height);

  gl.disable(gl.DEPTH_TEST);
  gl.disable(gl.BLEND);

  let stopped = false;
  let animationFrame: number | undefined;
  let videoFrame: number | undefined;

  const draw = () => {
    if (stopped) return;
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, videoTexture);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        video,
      );

      const destinationIndex = previousIndex === 0 ? 1 : 0;
      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        historyTextures[destinationIndex],
        0,
      );
      gl.viewport(0, 0, width, height);
      gl.useProgram(keyProgram);
      bindQuad(gl, keyProgram, buffer);
      gl.uniform1i(gl.getUniformLocation(keyProgram, "videoTexture"), 0);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, historyTextures[previousIndex]);
      gl.uniform1i(gl.getUniformLocation(keyProgram, "previousTexture"), 1);
      gl.uniform2f(
        gl.getUniformLocation(keyProgram, "texelSize"),
        1 / width,
        1 / height,
      );
      gl.uniform1f(
        gl.getUniformLocation(keyProgram, "historyStrength"),
        hasHistory ? 0.2 : 0,
      );
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.useProgram(copyProgram);
      bindQuad(gl, copyProgram, buffer);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, historyTextures[destinationIndex]);
      gl.uniform1i(gl.getUniformLocation(copyProgram, "frameTexture"), 0);
      gl.drawArrays(gl.TRIANGLES, 0, 6);

      previousIndex = destinationIndex;
      hasHistory = true;
    }

    if ("requestVideoFrameCallback" in video) {
      videoFrame = video.requestVideoFrameCallback(draw);
    } else {
      animationFrame = window.requestAnimationFrame(draw);
    }
  };

  draw();

  return {
    resize(nextWidth, nextHeight) {
      const normalizedWidth = Math.max(320, Math.round(nextWidth));
      const normalizedHeight = Math.max(180, Math.round(nextHeight));
      if (width === normalizedWidth && height === normalizedHeight) return;
      resizeBuffers(normalizedWidth, normalizedHeight);
    },
    stop() {
      stopped = true;
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      if (videoFrame !== undefined && "cancelVideoFrameCallback" in video) {
        video.cancelVideoFrameCallback(videoFrame);
      }
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(videoTexture);
      gl.deleteTexture(historyTextures[0]);
      gl.deleteTexture(historyTextures[1]);
      gl.deleteBuffer(buffer);
      gl.deleteProgram(keyProgram);
      gl.deleteProgram(copyProgram);
      gl.deleteShader(vertexShader);
      gl.deleteShader(keyFragmentShader);
      gl.deleteShader(copyFragmentShader);
    },
  };
}
