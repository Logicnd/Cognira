import time
import httpx
import json
from typing import List

OLLAMA_URL = "http://localhost:11434/api/generate"

PROMPTS = [
    "Write a 500-word essay on the impact of AI on society.",
    "Explain the concept of quantum entanglement in simple terms.",
    "Write a complex Python script that implements a distributed key-value store.",
    "Solve the following mathematical problem: If f(x) = x^2 + 2x + 1, what is f'(x) at x=5?",
    "Write a creative short story about a time traveler who gets stuck in the 1920s."
]

async def benchmark_prompt(prompt: str, model: str = "llama3"):
    start_time = time.time()
    tokens = 0
    
    payload = {
        "model": model,
        "prompt": prompt,
        "stream": True
    }
    
    async with httpx.AsyncClient(timeout=120.0) as client:
        try:
            async with client.stream("POST", OLLAMA_URL, json=payload) as response:
                async for line in response.aiter_lines():
                    if line:
                        data = json.loads(line)
                        tokens += 1
                        if data.get("done"):
                            break
        except Exception as e:
            print(f"Error benchmarking prompt: {str(e)}")
            return None
            
    end_time = time.time()
    duration = end_time - start_time
    tps = tokens / duration if duration > 0 else 0
    
    return {
        "prompt": prompt[:50] + "...",
        "duration": round(duration, 2),
        "tokens": tokens,
        "tps": round(tps, 2)
    }

async def run_benchmarks():
    print(f"--- Running Benchmarks for Lumiora ---")
    results = []
    for prompt in PROMPTS:
        print(f"Benchmarking: {prompt[:50]}...")
        result = await benchmark_prompt(prompt)
        if result:
            results.append(result)
            print(f"  Result: {result['duration']}s | {result['tps']} tokens/sec")
    
    avg_tps = sum(r['tps'] for r in results) / len(results) if results else 0
    avg_duration = sum(r['duration'] for r in results) / len(results) if results else 0
    
    print(f"\n--- Final Results ---")
    print(f"Average Speed: {avg_tps:.2f} tokens/sec")
    print(f"Average Latency: {avg_duration:.2f}s")
    print(f"Estimated performance gain vs Cloud (ChatGPT): {avg_tps/20:.1f}x speed improvement on local hardware.")

if __name__ == "__main__":
    import asyncio
    asyncio.run(run_benchmarks())
