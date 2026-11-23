/** Keep a chapter image independently of the decoder's rolling preview cache. */
export async function loadChapterImage(src: string, signal: AbortSignal): Promise<string | null> {
    const response = await fetch(src, { signal });
    if (!response.ok) return null;
    const blob = await response.blob();
    if (signal.aborted || !blob.size) return null;

    const url = URL.createObjectURL(blob);
    let usable = false;
    try {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (signal.aborted) return null;

        const canvas = document.createElement("canvas");
        canvas.width = 32;
        canvas.height = 18;
        const context = canvas.getContext("2d");
        if (context) {
            context.drawImage(image, 0, 0, canvas.width, canvas.height);
            const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
            let dark = 0;
            for (let index = 0; index < data.length; index += 4) {
                if (Math.max(data[index], data[index + 1], data[index + 2]) < 20) dark++;
            }
            // A conservative cutoff keeps dark scenes with visible detail.
            if (dark >= canvas.width * canvas.height * 0.98) return null;
        }
        usable = true;
        return url;
    } finally {
        if (!usable) URL.revokeObjectURL(url);
    }
}
