import { VertexAI } from '@google-cloud/vertexai';

const vertex_ai = new VertexAI({project: 'fna-stats', location: 'us-central1'});
const modelName = 'gemini-3-pro-preview'; 

async function generateContent() {
  try {
    const generativeModel = vertex_ai.getGenerativeModel({
      model: modelName,
    });

    // En Gemini 3 Pro Preview, el "Thinking Mode" suele venir activo 
    // por defecto en nivel 'high' para este modelo específico.
    const request = {
      contents: [{
        role: 'user', 
        parts: [{text: 'Hola Gemini 3 Pro. Confirma que puedes leer este mensaje y dime una breve ventaja de usar modelos con razonamiento (thinking) para analizar datos de salud.'}]
      }],
    };

    console.log(`Conectando con ${modelName}... \n`);
    const streamingResp = await generativeModel.generateContentStream(request);
    
    for await (const item of streamingResp.stream) {
      if (item.candidates[0].content.parts[0].text) {
        process.stdout.write(item.candidates[0].content.parts[0].text);
      }
    }
    console.log('\n\n✅ Conexión con Gemini 3 Pro Preview exitosa.');
  } catch (error) {
    // Si el error persiste, intentaremos con gemini-1.5-pro
    console.error('❌ Error:', error.message);
    console.log('Probando fallback a gemini-1.5-pro...');
  }
}

generateContent();