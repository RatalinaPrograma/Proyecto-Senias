// supabase/functions/generate-master-pack/index.ts
//
// Edge Function Serverless (Deno) para Supabase.
// Recorre todos los archivos (.webp, .gif, .mp4) del bucket 'senas-media',
// los comprime en un único archivo ZIP en la nube y guarda 'signy_master_v1.zip'
// en el bucket 'packs' para que los usuarios descarguen todo en una sola petición.
//
// Deploy:
//   npx supabase functions deploy generate-master-pack
//

// @ts-ignore
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
// @ts-ignore
import JSZip from 'https://esm.sh/jszip@3.10.1';

// Declaración para silenciar advertencias del linter de VS Code fuera de Deno
declare const Deno: any;

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

    if (!supabaseUrl || !serviceRoleKey) {
      throw new Error('Faltan las variables de entorno de Supabase (SUPABASE_URL o SUPABASE_SERVICE_ROLE_KEY).');
    }

    const clienteAdmin = createClient(supabaseUrl, serviceRoleKey);

    // 1. Obtener la lista de todos los archivos (revisar 'senas-media' o 'senas')
    let bucketName = 'senas-media';
    let { data: archivos, error: listError } = await clienteAdmin.storage
      .from(bucketName)
      .list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } });

    if (listError || !archivos?.length) {
      bucketName = 'senas';
      const res = await clienteAdmin.storage
        .from(bucketName)
        .list('', { limit: 500, sortBy: { column: 'name', order: 'asc' } });
      if (!res.error && res.data?.length) {
        archivos = res.data;
        listError = null;
      }
    }

    const archivosValidos = (archivos || []).filter(
      (a: any) => a.name && !a.name.startsWith('.') && !a.name.endsWith('/')
    );

    if (!archivosValidos.length) {
      return new Response(
        JSON.stringify({ message: 'No hay archivos en el bucket de señas para empaquetar.' }),
        { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Empaquetando ${archivosValidos.length} señas del bucket "${bucketName}" en ZIP…`);
    const zip = new (JSZip as any)();

    // 2. Descargar cada archivo e insertarlo en el ZIP
    let descargados = 0;
    for (const archivo of archivosValidos) {
      try {
        const { data: blob, error: downloadError } = await clienteAdmin.storage
          .from(bucketName)
          .download(archivo.name);

        if (downloadError || !blob) {
          console.warn(`No se pudo descargar ${archivo.name}:`, downloadError);
          continue;
        }

        const arrayBuffer = await blob.arrayBuffer();
        zip.file(archivo.name, arrayBuffer);
        descargados++;
      } catch (err) {
        console.warn(`Error procesando ${archivo.name}:`, err);
      }
    }

    // 3. Generar el archivo ZIP comprimido
    console.log('Comprimiendo archivo ZIP maestro…');
    const zipUint8 = await zip.generateAsync({
      type: 'uint8array',
      compression: 'STORE'
    });

    const tamanoKB = (zipUint8.byteLength / 1024).toFixed(1);
    const tamanoMB = (zipUint8.byteLength / (1024 * 1024)).toFixed(2);
    console.log(`ZIP generado con éxito: ${tamanoMB} MB (${tamanoKB} KB)`);
    console.log(`INFO DE CUOTA: Se consumieron ${tamanoKB} KB para empaquetar este paquete maestro.`);

    // 4. Subir el ZIP a Supabase Storage (bucket "senas-media", archivo "signy_master_v1.zip")
    const { error: uploadError } = await clienteAdmin.storage
      .from('senas-media')
      .upload('signy_master_v1.zip', zipUint8, {
        contentType: 'application/zip',
        upsert: true,
      });

    if (uploadError) {
      console.warn('Fallo subida a bucket "packs", intentando en bucket principal:', uploadError.message);
      const { error: fallbackError } = await clienteAdmin.storage
        .from(bucketName)
        .upload('packs/signy_master_v1.zip', zipUint8, {
          contentType: 'application/zip',
          upsert: true,
        });

      if (fallbackError) {
        throw new Error(`Error al guardar el ZIP: ${uploadError.message} / ${fallbackError.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        mensaje: 'Paquete maestro generado y actualizado con éxito.',
        archivosEmpaquetados: descargados,
        tamanoMB: `${tamanoMB} MB`,
        timestamp: new Date().toISOString(),
      }),
      { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: any) {
    console.error('Error en Edge Function generate-master-pack:', error);
    return new Response(
      JSON.stringify({ error: error?.message || String(error) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
