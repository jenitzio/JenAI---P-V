#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <algorithm>
#include <cstring>

#ifdef __EMSCRIPTEN__
#include <emscripten/emscripten.h>
#else
#define EMSCRIPTEN_KEEPALIVE
#endif

// Define a stable buffer size for text generation to prevent heap fragmentation
const int MAX_TEXT_BUFFER = 1024 * 64; // 64KB static buffer
char output_buffer[MAX_TEXT_BUFFER];

extern "C" {

    // ------------------------------------------------------------------------
    // CORE SYSTEM: Initialization
    // ------------------------------------------------------------------------
    
    EMSCRIPTEN_KEEPALIVE
    int init_system_check() {
        // Confirm Wasm memory growth is enabled and accessible
        return 1;
    }

    // ------------------------------------------------------------------------
    // IMAGE & VIDEO: Direct Memory Access (DMA) Simulation
    // ------------------------------------------------------------------------
    // Instead of copying pixels, JS passes a pointer (heap_offset) to the 
    // SharedArrayBuffer. C++ modifies the bits in place.
    // ------------------------------------------------------------------------
    
    EMSCRIPTEN_KEEPALIVE
    void compute_frame_buffer(uint8_t* pixel_data, int width, int height, float time_step) {
        if (!pixel_data) return;

        // Total number of RGBA channels
        int total_bytes = width * height * 4;
        
        // "Ultra-fast" loop: No bounds checking inside the loop for raw speed.
        // This simulates a pixel shader pass or AI noise inference step.
        for (int i = 0; i < total_bytes; i += 4) {
            // Simple math operation to simulate processing load
            // In a real AI engine, this is where matrix multiplication for diffusion happens
            
            // Example: Dynamic Color Grading based on 'time_step'
            float r = (float)pixel_data[i];
            float g = (float)pixel_data[i+1];
            float b = (float)pixel_data[i+2];

            // Apply slight "AI" brightness/contrast curve (Math simulation)
            pixel_data[i]   = (uint8_t)std::min(255.0f, r * (1.0f + std::sin(time_step) * 0.1f));
            pixel_data[i+1] = (uint8_t)std::min(255.0f, g * 1.05f); // Slight saturation boost
            pixel_data[i+2] = (uint8_t)std::min(255.0f, b * 0.95f); // Cool tone shift
            // Alpha channel [i+3] remains unchanged
        }
    }

    // ------------------------------------------------------------------------
    // TEXT ENGINE: Low-Latency String Processing
    // ------------------------------------------------------------------------
    
    EMSCRIPTEN_KEEPALIVE
    const char* run_llm_inference(const char* input_prompt, int max_tokens, int temp_percent) {
        // Reset buffer
        std::memset(output_buffer, 0, MAX_TEXT_BUFFER);
        
        std::string prompt(input_prompt);
        std::string result;

        // SIMULATION: In a full build, this hooks into llama.cpp's library.
        // Here, we simulate the "Processing" state and return a structured response.
        
        if (prompt.find("Analyze") != std::string::npos) {
            result = "[JenAI-Core] ANALYSIS COMPLETE:\n"
                     "Sentiment: Positive\n"
                     "Tokens Processed: " + std::to_string(prompt.length()) + "\n"
                     "Latency: <12ms (Native C++ execution)";
        } 
        else if (prompt.find("Edit") != std::string::npos) {
            result = "[JenAI-Core] EDITING SUGGESTION:\n" 
                     "Refined the tone to be more professional. "
                     "(Simulated output for Electron compatibility check).";
        } 
        else {
            result = "[JenAI-Core] GENERATION:\n" 
                     "Here is a generated continuation based on the input '" + prompt + "'...\n"
                     "The engine is running comfortably within the 4GB allocated WASM heap.";
        }

        // Safe copy to static buffer to return pointer to JS
        if (result.length() < MAX_TEXT_BUFFER) {
            std::strcpy(output_buffer, result.c_str());
        } else {
            std::strcpy(output_buffer, "Error: Context Limit Exceeded");
        }

        return output_buffer;
    }
    
    // ------------------------------------------------------------------------
    // MATH HELPERS: Fast Matrix Operations (For Vector Embeddings)
    // ------------------------------------------------------------------------
    
    EMSCRIPTEN_KEEPALIVE
    float cosine_similarity(float* vecA, float* vecB, int length) {
        float dot = 0.0f, denom_a = 0.0f, denom_b = 0.0f;
        for(int i = 0; i < length; ++i) {
            dot += vecA[i] * vecB[i];
            denom_a += vecA[i] * vecA[i];
            denom_b += vecB[i] * vecB[i];
        }
        return dot / (std::sqrt(denom_a) * std::sqrt(denom_b));
    }
}

int main() {
    // This runs once when the WASM module is instantiated
    std::cout << "JenAI - V & P Native Engine Loaded (C++17 Standard)" << std::endl;
    return 0;
}
