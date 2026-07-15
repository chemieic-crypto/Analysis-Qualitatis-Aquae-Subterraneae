/**
 * Converts a raw Little-Endian 16-bit PCM base64 string from Gemini TTS
 * into a standard playble WAV file Object URL with accurate headers.
 */
export function createWavUrlFromBase64(base64: string, sampleRate = 24000): string {
  if (!base64) return "";
  
  // Decode base64 to binary string
  const binaryString = window.atob(base64);
  const len = binaryString.length;
  
  // If the payload already contains a WAV container (starts with "RIFF"), return as-is wrapped in a Blob
  if (binaryString.startsWith("RIFF")) {
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: "audio/wav" });
    return URL.createObjectURL(blob);
  }
  
  // Create solid WAV header (44 bytes) + audio payload
  const bytes = new Uint8Array(44 + len);
  
  // 1. "RIFF" chunk descriptor
  bytes[0] = 0x52; // R
  bytes[1] = 0x49; // I
  bytes[2] = 0x46; // F
  bytes[3] = 0x46; // F
  
  // Chunck Size: 36 + subChunk2Size (which is len)
  const fileLen = 36 + len;
  bytes[4] = fileLen & 0xff;
  bytes[5] = (fileLen >> 8) & 0xff;
  bytes[6] = (fileLen >> 16) & 0xff;
  bytes[7] = (fileLen >> 24) & 0xff;
  
  // "WAVE" format
  bytes[8] = 0x57;  // W
  bytes[9] = 0x41;  // A
  bytes[10] = 0x56; // V
  bytes[11] = 0x45; // E
  
  // 2. "fmt " subchunk descriptor
  bytes[12] = 0x66; // f
  bytes[13] = 0x6d; // m
  bytes[14] = 0x74; // t
  bytes[15] = 0x20; // ' ' (space)
  
  // Subchunk1 Size (16 for PCM)
  bytes[16] = 16;
  bytes[17] = 0;
  bytes[18] = 0;
  bytes[19] = 0;
  
  // Audio Format (1 for PCM)
  bytes[20] = 1;
  bytes[21] = 0;
  
  // Number of Channels (1 for Mono)
  bytes[22] = 1;
  bytes[23] = 0;
  
  // Sample Rate (usually 24000 Hz)
  bytes[24] = sampleRate & 0xff;
  bytes[25] = (sampleRate >> 8) & 0xff;
  bytes[26] = (sampleRate >> 16) & 0xff;
  bytes[27] = (sampleRate >> 24) & 0xff;
  
  // Byte Rate (SampleRate * NumChannels * BitsPerSample/8) -> sampleRate * 1 * 2
  const byteRate = sampleRate * 2;
  bytes[28] = byteRate & 0xff;
  bytes[29] = (byteRate >> 8) & 0xff;
  bytes[30] = (byteRate >> 16) & 0xff;
  bytes[31] = (byteRate >> 24) & 0xff;
  
  // Block Align (NumChannels * BitsPerSample/8) -> 1 * 2 = 2
  bytes[32] = 2;
  bytes[33] = 0;
  
  // Bits Per Sample (16-bit)
  bytes[34] = 16;
  bytes[35] = 0;
  
  // 3. "data" subchunk descriptor
  bytes[36] = 0x64; // d
  bytes[37] = 0x61; // a
  bytes[38] = 0x74; // t
  bytes[39] = 0x61; // a
  
  // Subchunk2 Size (Length of PCM data)
  bytes[40] = len & 0xff;
  bytes[41] = (len >> 8) & 0xff;
  bytes[42] = (len >> 16) & 0xff;
  bytes[43] = (len >> 24) & 0xff;
  
  // Copy PCM data bytes right after the header
  for (let i = 0; i < len; i++) {
    bytes[44 + i] = binaryString.charCodeAt(i);
  }
  
  const blob = new Blob([bytes], { type: "audio/wav" });
  return URL.createObjectURL(blob);
}

/**
 * Calculates reading time in seconds based on average speaking pace
 */
export function estimateAudioDuration(text: string): number {
  if (!text) return 0;
  // Standard speaking rate is approx 130-150 words per minute (2.2 to 2.5 words per second)
  const words = text.trim().split(/\s+/).length;
  return Math.max(5, Math.round((words / 140) * 60));
}

/**
 * Clean up HTML/Markdown to get actual plain text length advice
 */
export function countWords(text: string): number {
  if (!text) return 0;
  return text.trim().split(/\s+/).filter(Boolean).length;
}
