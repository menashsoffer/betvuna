import { toSquareJpeg } from './image';

export interface Camera {
  video: HTMLVideoElement;
  capture(): Promise<Blob>;
  stop(): void;
}

/** Front camera in a <video>. Throws when there is no camera or no permission; the caller falls back to a file input. */
export async function openCamera(video: HTMLVideoElement): Promise<Camera> {
  if (!navigator.mediaDevices?.getUserMedia) throw new Error('no_camera');
  const stream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 1280 } },
    audio: false,
  });
  video.srcObject = stream;
  video.muted = true;
  video.setAttribute('playsinline', '');
  await video.play();
  const stop = () => stream.getTracks().forEach((t) => t.stop());
  return {
    video,
    stop,
    capture: () => toSquareJpeg(
      Object.assign(video, { width: video.videoWidth, height: video.videoHeight }),
      true,
    ),
  };
}
