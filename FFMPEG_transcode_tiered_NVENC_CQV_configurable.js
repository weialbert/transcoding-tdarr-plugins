/* eslint-disable */
const details = () => {
  return {
    id: 'Tdarr_Plugin_vdka_Tiered_NVENC_CQV_BASED_CONFIGURABLE',
    Stage: 'Pre-processing',
    Name: 'Tiered FFMPEG+NVENC CQ:V BASED CONFIGURABLE',
    Type: 'Video',
    Operation: 'Transcode',
    Description: `[Contains built-in filter] This plugin uses different CQ:V values (similar to crf but for nvenc) depending on resolution. 
    The CQ:V value is configurable per resolution.
    FFmpeg Preset can be configured, defaults to **medium** instead of slow for better performance.
    RC-lookahead reduced to 16 for faster transcoding. Default B-frames reduced to 3.
    If files are not in HEVC or exceed bitrate thresholds, they will be transcoded.
    The output container is MKV.\n\n`,
    Version: '1.10',
    Tags: 'pre-processing,ffmpeg,video only,nvenc h265,configurable',

    Inputs: [
      {
        name: 'sdCQV',
        type: 'string',
        defaultValue: '21',
        inputUI: {
          type: 'text',
        },
        tooltip: `Enter the CQ:V value you want for 480p/576p content.
        Example: 21`
      },
      {
        name: 'hdCQV',
        type: 'string',
        defaultValue: '23',
        inputUI: {
          type: 'text',
        },
        tooltip: `Enter the CQ:V value you want for 720p content.
        Example: 23`
      },
      {
        name: 'fullhdCQV',
        type: 'string',
        defaultValue: '25',
        inputUI: {
          type: 'text',
        },
        tooltip: `Enter the CQ:V value you want for 1080p content.
        Example: 25`
      },
      {
        name: 'uhdCQV',
        type: 'string',
        defaultValue: '28',
        inputUI: {
          type: 'text',
        },
        tooltip: `Enter the CQ:V value you want for 4K/UHD/2160p content.
        Example: 28`
      },
      {
        name: 'bframe',
        type: 'string',
        defaultValue: '3',
        inputUI: {
          type: 'text',
        },
        tooltip: `Specify amount of B-frames to use, 0–5.
        GPU must support this (Turing+ except GTX 1650).
        Example: 3`
      },
      {
        name: 'ffmpeg_preset',
        type: 'string',
        defaultValue: 'medium',
        inputUI: {
          type: 'text',
        },
        tooltip: `OPTIONAL, DEFAULTS TO MEDIUM
        Enter the FFmpeg preset you want, leave blank for default (medium).
        Applies only if video is transcoded.
        Example: medium`
      }
    ]
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const plugin = (file, librarySettings, inputs, otherArguments) => {
  const lib = require('../methods/lib')();
  inputs = lib.loadDefaultValues(inputs, details);

  let transcode = 0;
  let subcli = `-c:s copy`;
  let maxmux = '';
  let map = '-map 0';
  let cqvinuse = '';
  
  const response = {
    processFile: false,
    preset: '',
    container: '.mkv',
    handBrakeMode: false,
    FFmpegMode: false,
    reQueueAfter: true,
    infoLog: '',
  };

  if (file.fileMedium !== 'video') {
    response.infoLog += '☒File is not a video!\n';
    return response;
  } else {
    response.infoLog += '☑File is a video!\n';
  }

  if (file.ffProbeData.streams[0].codec_name == 'hevc') {
    let bitrate = parseInt(file.ffProbeData.streams[0].bit_rate || file.ffProbeData.format.bit_rate || 0);
    if (!bitrate || bitrate === 0) {
      const durationSec = parseFloat(file.ffProbeData.format.duration || 0);
      const fileSizeBytes = parseInt(file.ffProbeData.format.size || 0);
      if (durationSec && fileSizeBytes) {
        bitrate = (fileSizeBytes * 8) / durationSec;
        response.infoLog += `☑Estimated bitrate from file size: ${(bitrate/1000000).toFixed(2)} Mbps\n`;
      }
    }
    response.infoLog += `☑Bitrate: ${(bitrate/1000000).toFixed(2)} Mbps\n`;

    const bitrateThreshold = 30000000; // 30 Mbps

    if (bitrate > bitrateThreshold) {
      response.infoLog += `☒File is HEVC but exceeds bitrate threshold (${(bitrate/1000000).toFixed(2)} Mbps > 30 Mbps), forcing re-encode\n`;
      transcode = 1;
    } else {
      response.infoLog += `☑File is already in HEVC and bitrate acceptable, skipping\n`;
      return response;
    }
  }

  let ffmpeg_preset = inputs.ffmpeg_preset || 'medium';
  response.infoLog += `☑Preset set to ${ffmpeg_preset}\n`;

  // default NVDEC decoding
  const decode = `-hwaccel cuda -hwaccel_output_format cuda`;

  // subtitle and audio handling
  for (const stream of file.ffProbeData.streams) {
    try {
      if (stream.codec_type?.toLowerCase() === 'subtitle' && stream.codec_name?.toLowerCase() === 'mov_text') {
        subcli = `-c:s srt`;
      }
    } catch {}

    try {
      if (
        stream.codec_name?.toLowerCase() === 'truehd' ||
        (stream.codec_name?.toLowerCase() === 'dts' && stream.profile?.toLowerCase() === 'dts-hd ma') ||
        (stream.codec_name?.toLowerCase() === 'aac' && stream.sample_rate === '44100')
      ) {
        maxmux = ` -max_muxing_queue_size 9999`;
      }
    } catch {}

    try {
      if (
        ['png', 'bmp', 'mjpeg'].includes(stream.codec_name?.toLowerCase() || '') &&
        stream.codec_type?.toLowerCase() === 'video'
      ) {
        map = `-map 0:v:0 -map 0:a -map 0:s?`;
      }
    } catch {}
  }

  // build resolution based commands
  const resolutions = {
    '480p': inputs.sdCQV,
    '576p': inputs.sdCQV,
    '720p': inputs.hdCQV,
    '1080p': inputs.fullhdCQV,
    '4KUHD': inputs.uhdCQV,
  };

  if (resolutions[file.video_resolution]) {
    cqvinuse = resolutions[file.video_resolution];
    response.preset +=
      `${decode},${map} -dn -c:v hevc_nvenc -b:v 0 -preset ${ffmpeg_preset} -cq ${cqvinuse} -rc-lookahead 16 -bf ${inputs.bframe} -a53cc 0 -c:a copy ${subcli}${maxmux}`;
    transcode = 1;
  }

  if (transcode === 1) {
    response.processFile = true;
    response.FFmpegMode = true;
    response.reQueueAfter = true;
    response.infoLog += `☑File is ${file.video_resolution} ${file.video_codec_name}, using CQ:V ${cqvinuse}\n`;
    response.infoLog += `File is being transcoded!\n`;
  }

  return response;
};

module.exports.details = details;
module.exports.plugin = plugin;
