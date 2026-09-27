// SPDX-License-Identifier: LGPL-2.1-or-later
#include <stdint.h>
#include <string.h>
#include <libavcodec/avcodec.h>
#include <libavutil/log.h>
#include <libavutil/pixfmt.h>

static AVCodecContext *decoder;
static AVFrame *frame;

int begin(int codec, const uint8_t *extra, int extra_size) {
  // Untrusted packets must not amplify into unbounded stderr output.
  av_log_set_level(AV_LOG_QUIET);
  const enum AVCodecID codecs[] = {
    AV_CODEC_ID_H264, AV_CODEC_ID_HEVC, AV_CODEC_ID_VP8, AV_CODEC_ID_VP9
  };
  if (codec < 0 || codec >= 4) return AVERROR(EINVAL);
  const AVCodec *implementation = avcodec_find_decoder(codecs[codec]);
  if (!implementation) return AVERROR_DECODER_NOT_FOUND;
  decoder = avcodec_alloc_context3(implementation);
  frame = av_frame_alloc();
  if (!decoder || !frame) return AVERROR(ENOMEM);
  decoder->thread_count = 1;
  decoder->thread_type = 0;
  // Callers read byte planes; preserve the full bitstream display crop.
  decoder->flags |= AV_CODEC_FLAG_UNALIGNED;
  if (extra_size) {
    decoder->extradata = av_mallocz(extra_size + AV_INPUT_BUFFER_PADDING_SIZE);
    if (!decoder->extradata) return AVERROR(ENOMEM);
    memcpy(decoder->extradata, extra, extra_size);
    decoder->extradata_size = extra_size;
  }
  return avcodec_open2(decoder, implementation, NULL);
}

int push(uint8_t *bytes, int length) {
  AVPacket packet = {0};
  packet.data = bytes;
  packet.size = length;
  return avcodec_send_packet(decoder, &packet);
}

int finish(void) {
  int status = avcodec_send_packet(decoder, NULL);
  if (status < 0) return status;
  status = avcodec_receive_frame(decoder, frame);
  if (status < 0) return status;
  if (frame->format != AV_PIX_FMT_YUV420P && frame->format != AV_PIX_FMT_YUVJ420P)
    return -1;
  return 0;
}

int width(void) { return frame->width; }
int height(void) { return frame->height; }
const uint8_t *plane(int index) { return frame->data[index]; }
int stride(int index) { return frame->linesize[index]; }
int full_range(void) {
  if (frame->color_range == AVCOL_RANGE_JPEG || frame->format == AV_PIX_FMT_YUVJ420P)
    return 1;
  if (frame->color_range == AVCOL_RANGE_MPEG) return 0;
  return -1;
}
void close_decoder(void) {
  av_frame_free(&frame);
  avcodec_free_context(&decoder);
}
