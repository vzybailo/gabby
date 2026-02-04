import { useState, useRef } from 'react';

interface VoiceInputProps {
  onSend: (text: string) => void;
  loading: boolean;
}

const API_URL = import.meta.env.API_URL;

export default function VoiceInput({ onSend, loading }: VoiceInputProps) {
  const [recording, setRecording] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const audioChunksRef = useRef<BlobPart[]>([]);

  async function startRecording() {
    if (loading) return;

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      mediaRecorderRef.current = mediaRecorder;
      audioChunksRef.current = [];

      mediaRecorder.ondataavailable = e => {
        if (e.data.size > 0) audioChunksRef.current.push(e.data);
      };

      mediaRecorder.start();
      setRecording(true);
    } catch (err) {
      console.error('Microphone access denied or error:', err);
      alert('Cannot access microphone. Check permissions.');
    }
  }

  function stopRecording() {
    if (!mediaRecorderRef.current) return;

    const mediaRecorder = mediaRecorderRef.current;

    mediaRecorder.onstop = async () => {
      setRecording(false);

      const audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm' });

      if (audioBlob.size < 1000) {
        alert('Recording too short, hold the button longer.');
        return;
      }

      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');

      try {
        const res = await fetch(API_URL, {
          method: 'POST',
          body: formData,
        });

        if (!res.ok) throw new Error('Transcription failed');

        const data = await res.json();
        if (data.text) onSend(data.text);
      } catch (err) {
        console.error(err);
        alert('Failed to transcribe audio. Check server and API key.');
      }
    };

    mediaRecorder.stop();
  }

  return (
    <button
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      disabled={loading}
      className={`
        px-4 py-2 rounded-lg text-white font-semibold
        ${recording ? 'bg-red-600' : 'bg-green-600'}
        hover:opacity-80 disabled:opacity-50 disabled:cursor-not-allowed
      `}
    >
      {recording ? 'Recording...' : 'Hold to Talk'}
    </button>
  );
}
