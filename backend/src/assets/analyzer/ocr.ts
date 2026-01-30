import Tesseract from "tesseract.js";

export async function extractText(
  imagePath: string,
  lang: string = "eng",
): Promise<string> {
  const result = await Tesseract.recognize(imagePath, lang);
  return result.data.text;
}
