/* eslint-disable */
const details = () => ({
  id: "Tdarr_Plugin_a9hd_FFMPEG_Transcode_Specific_Audio_Stream_Codecs",
  Stage: "Pre-processing",
  Name: "Transcode Specific Audio Stream Codecs by Language",
  Type: "Audio",
  Operation: "Transcode",
  Description: `Transcodes specific audio streams to a target codec if no stream with that language already exists in that codec. Does NOT duplicate maps to avoid ffmpeg errors.`,

  Version: "1.11",
  Tags: "pre-processing,audio,ffmpeg",
  Inputs: [
    {
      name: "codecs_to_transcode",
      type: "string",
      defaultValue: "truehd",
      inputUI: { type: "text" },
      tooltip: `Specify the codecs to transcode. Comma separated.`
    },
    {
      name: "codec",
      type: "string",
      defaultValue: "eac3",
      inputUI: { type: "text" },
      tooltip: `Target codec, e.g. eac3`
    },
    {
      name: "bitrate",
      type: "string",
      defaultValue: "",
      inputUI: { type: "text" },
      tooltip: `Bitrate, e.g. 640k`
    },
  ],
});

const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require("../methods/lib")();
  inputs = lib.loadDefaultValues(inputs, details);

  const response = {
    processFile: false,
    preset: "",
    container: "." + file.container,
    handBrakeMode: false,
    FFmpegMode: true,
    reQueueAfter: false,
    infoLog: "",
  };

  const enc = inputs.codec.toLowerCase();
  const sourceCodecs = inputs.codecs_to_transcode.split(",").map(x => x.trim().toLowerCase());

  // find existing target codecs by language
  const existing = {};
  for (const s of file.ffProbeData.streams) {
    if (s.codec_type === "audio") {
      const lang = s.tags?.language || "und";
      if (s.codec_name?.toLowerCase() === enc) {
        existing[lang] = true;
      }
    }
  }

  // Build FFmpeg command parts
  const commandParts = [];
  
  // Map video streams
  commandParts.push('-map 0:v -c:v copy');
  
  // Map subtitle streams if they exist
  commandParts.push('-map 0:s? -c:s copy');
  
  // Map data streams if they exist
  commandParts.push('-map 0:d? -c:d copy');

  let audioIndex = 0;
  let changed = false;

  // Process each audio stream
  for (let i = 0; i < file.ffProbeData.streams.length; i++) {
    const s = file.ffProbeData.streams[i];
    if (s.codec_type === "audio") {
      const lang = s.tags?.language || "und";
      
      // Map this audio stream
      commandParts.push(`-map 0:${i}`);
      
      if (sourceCodecs.includes(s.codec_name?.toLowerCase())) {
        if (existing[lang]) {
          response.infoLog += `☑ Skipping ${s.codec_name} (${lang}) since ${enc} already exists for that language\n`;
          commandParts.push(`-c:a:${audioIndex} copy`);
        } else {
          response.infoLog += `☒ Transcoding ${s.codec_name} (${lang}) to ${enc}\n`;
          commandParts.push(`-c:a:${audioIndex} ${enc}`);
          if (inputs.bitrate) {
            commandParts.push(`-b:a:${audioIndex} ${inputs.bitrate}`);
          }
          changed = true;
        }
      } else {
        // leave other audio untouched
        commandParts.push(`-c:a:${audioIndex} copy`);
      }
      audioIndex++;
    }
  }

  // Add final options
  commandParts.push('-max_muxing_queue_size 9999');

  if (!changed) {
    response.infoLog += `☑ Nothing to transcode\n`;
    response.processFile = false;
    return response;
  } else {
    // Use <io> separator to tell Tdarr where to place the input file
    response.preset = `<io>${commandParts.join(' ')}`;
    response.processFile = true;
    response.reQueueAfter = true;
    response.infoLog += `\nFFmpeg command: ${response.preset}\n`;
    return response;
  }
};

module.exports.details = details;
module.exports.plugin = plugin;
