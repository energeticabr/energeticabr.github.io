// Build against the public GWTimes IoTVideo-PC headers and import library.
#include <atomic>
#include <chrono>
#include <cstdint>
#include <cstdio>
#include <cstdlib>
#include <fcntl.h>
#include <io.h>
#include <iostream>
#include <mutex>
#include <string>
#include <thread>

#include "IoTVideoPlayer.h"

extern "C" __declspec(dllimport) int __stdcall SetStdHandle(unsigned long, void*);
std::atomic<bool> stop_requested{false};

class CloudVideo final : public VideoDecoder {
public:
    CloudVideo(int output, std::uint64_t device_id)
        : output_(output), device_id_(device_id) {}

    void init(AVHeader* header) override {
        if (header) {
            std::fprintf(stderr, "YOOSEE device %llu codec %d resolution %dx%d\n",
                         static_cast<unsigned long long>(device_id_ % 10000),
                         header->videoType, header->videoWidth, header->videoHeight);
        }
        if (!header || header->videoType != 5) {
            failed = true;
        }
    }

    int decode(AVData* packet, AVData*) override {
        if (failed || !packet || !packet->data || !packet->size) {
            return -1;
        }
        if (packet->size > 4 * 1024 * 1024) {
            failed = true;
            return -1;
        }
        const std::lock_guard<std::mutex> guard(output_lock_);
        if (!write(packet->data, packet->size)) {
            failed = true;
            return -1;
        }
        last_packet = now();
        // The camera gateway decodes this packet. The SDK renders no frame.
        return -1;
    }

    void release() override {}

    static std::int64_t now() {
        const auto elapsed = std::chrono::steady_clock::now().time_since_epoch();
        return std::chrono::duration_cast<std::chrono::milliseconds>(elapsed).count();
    }

    std::atomic<bool> failed{false};
    std::atomic<std::int64_t> last_packet{0};

private:
    bool write(const std::uint8_t* data, unsigned size) {
        std::size_t offset = 0;
        while (offset < size) {
            const auto remaining = static_cast<unsigned>(size - offset);
            const int written = _write(output_, data + offset, remaining);
            if (written <= 0) {
                return false;
            }
            offset += static_cast<unsigned>(written);
        }
        return true;
    }

    int output_;
    std::uint64_t device_id_;
    std::mutex output_lock_;
};

class SilentAudio final : public AudioRender {
public:
    void init(AVHeader*) override {}
    void frameUpdate(AVData*) override {}
    void release() override {}
};

class Stream {
public:
    Stream(int output, std::uint64_t device_id)
        : device_id_(device_id), decoder_(new CloudVideo(output, device_id)) {
        player_.setVideoDecoder(decoder_);
        player_.setAudioRender(new SilentAudio());
        player_.setErrorListener([this](int error) {
            decoder_->failed = error != 0;
            std::fprintf(stderr, "YOOSEE device %llu playback error %d\n",
                         static_cast<unsigned long long>(device_id_ % 10000), error);
        });
        player_.setStatusListener([this](int state) {
            std::fprintf(stderr, "YOOSEE device %llu state %d\n",
                         static_cast<unsigned long long>(device_id_ % 10000), state);
        });
    }

    void start() {
        started_ = CloudVideo::now();
        const char* quality = std::getenv("YOOSEE_STREAM_QUALITY");
        player_.setDataResource(device_id_, 1,
                                quality && *quality == 's' ? VIDEO_DEFINITION_SD : VIDEO_DEFINITION_HD);
        player_.play();
    }

    bool healthy() const {
        const auto packet_at = decoder_->last_packet.load();
        const auto current = CloudVideo::now();
        return !decoder_->failed && (packet_at ? current - packet_at < 18'000
                                               : current - started_ < 55'000);
    }

    void stop() { player_.stop(); }

private:
    std::uint64_t device_id_;
    CloudVideo* decoder_;
    IoTVideoPlayer player_;
    std::int64_t started_ = 0;
};

int main() {
    std::int64_t access_id;
    std::uint64_t device_id;
    std::string token;
    if (!(std::cin >> access_id >> device_id >> token) || !device_id || token.size() != 128) {
        return 2;
    }

    const int video = _dup(_fileno(stdout));
    if (video < 0 || _setmode(video, _O_BINARY) == -1
        || _dup2(_fileno(stderr), _fileno(stdout)) != 0
        || !SetStdHandle(static_cast<unsigned long>(-11),
                         reinterpret_cast<void*>(_get_osfhandle(_fileno(stderr))))) {
        return 2;
    }

    auto* sdk = IoTVideoSdk::getInstance();
    {
        Stream stream(video, device_id);
        std::thread([] {
            std::string shutdown;
            std::cin >> shutdown;
            stop_requested = true;
        }).detach();
        sdk->addModelDataListener([](std::string, std::string) {});
        sdk->Register(access_id, token);
        std::this_thread::sleep_for(std::chrono::seconds(4));
        stream.start();
        while (!stop_requested && stream.healthy()) {
            std::this_thread::sleep_for(std::chrono::milliseconds(250));
        }
        stream.stop();
    }
    sdk->unRegister();
    _close(video);
    return 1;
}
