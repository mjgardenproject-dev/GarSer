import { supabase } from '../lib/supabase';

export async function fixDatabaseIssues() {
  console.log('🔧 Iniciando corrección de base de datos usando funciones nativas...');
  
  try {
    // Primero, intentemos crear las tablas usando INSERT directo para verificar si existen
    console.log('📋 Verificando y creando estructura de availability...');
    
    // Intentar insertar un registro de prueba para ver si la tabla existe
    const testInsert = await supabase
      .from('availability_blocks')
      .insert({
        gardener_id: '00000000-0000-0000-0000-000000000000', // UUID de prueba
        date: '2025-01-01',
        hour_block: 0,
        is_available: true
      });

    if (testInsert.error && testInsert.error.code === 'PGRST116') {
      console.log('❌ Tabla availability no existe');
      return { 
        success: false, 
        message: 'Las tablas no existen en la base de datos. Necesitas aplicar las migraciones manualmente.',
        instructions: [
          '1. Ve a tu panel de Supabase (https://supabase.com/dashboard)',
          '2. Selecciona tu proyecto',
          '3. Ve a SQL Editor',
          '4. Ejecuta el contenido del archivo: supabase/migrations/20250101000000_enhanced_booking_system.sql',
          '5. Ejecuta el contenido del archivo: supabase/migrations/20250928230500_add_role_logs_table.sql',
          '6. Recarga la aplicación'
        ]
      };
    } else if (testInsert.error && testInsert.error.code === '23503') {
      // Error de foreign key - la tabla existe pero el UUID de prueba no es válido
      console.log('✅ Tabla availability existe');
      
      // Limpiar el registro de prueba si se insertó
      await supabase
        .from('availability_blocks')
        .delete()
        .eq('gardener_id', '00000000-0000-0000-0000-000000000000');
    }

    // Verificar tabla role_logs
    console.log('📋 Verificando tabla role_logs...');
    const testRoleLogsInsert = await supabase
      .from('role_logs')
      .insert({
        user_id: '00000000-0000-0000-0000-000000000000',
        action: 'test',
        details: 'test'
      });

    if (testRoleLogsInsert.error && testRoleLogsInsert.error.code === 'PGRST116') {
      console.log('❌ Tabla role_logs no existe');
      return { 
        success: false, 
        message: 'La tabla role_logs no existe. Necesitas aplicar las migraciones manualmente.',
        instructions: [
          '1. Ve a tu panel de Supabase (https://supabase.com/dashboard)',
          '2. Selecciona tu proyecto',
          '3. Ve a SQL Editor',
          '4. Ejecuta el contenido del archivo: supabase/migrations/20250928230500_add_role_logs_table.sql',
          '5. Recarga la aplicación'
        ]
      };
    } else if (testRoleLogsInsert.error && testRoleLogsInsert.error.code === '23503') {
      console.log('✅ Tabla role_logs existe');
      
      // Limpiar el registro de prueba si se insertó
      await supabase
        .from('role_logs')
        .delete()
        .eq('user_id', '00000000-0000-0000-0000-000000000000');
    }

    console.log('✅ Verificación completada - las tablas existen');
    return { 
      success: true, 
      message: 'Las tablas existen. Los errores 406 pueden ser por políticas RLS. Intenta usar la aplicación normalmente.' 
    };

  } catch (error) {
    console.error('❌ Error general en verificación de base de datos:', error);
    return { 
      success: false, 
      message: 'Error verificando la base de datos', 
      error: error.message 
    };
  }
}

// Función alternativa usando consultas directas si rpc no funciona
export async function fixDatabaseIssuesAlternative() {
  console.log('🔧 Iniciando corrección alternativa de base de datos...');
  
  try {
    // Verificar si availability_blocks existe intentando hacer una consulta
    console.log('🔍 Verificando tabla availability_blocks...');
    const { error: testError } = await supabase
      .from('availability_blocks')
      .select('id')
      .limit(1);

    if (testError && testError.code === '42P01') {
      console.log('❌ Tabla availability no existe');
      console.log('📝 Necesitas ejecutar las migraciones manualmente en Supabase Dashboard');
      console.log('🔗 Ve a: https://supabase.com/dashboard/project/[tu-proyecto]/sql');
      console.log('📋 Ejecuta el contenido del archivo: supabase/migrations/20251002000000_fix_database_issues.sql');
      return { success: false, needsManualMigration: true };
    } else if (testError) {
      console.error('❌ Error verificando availability:', testError);
      return { success: false, error: testError };
    } else {
      console.log('✅ Tabla availability existe');
      return { success: true };
    }

  } catch (error) {
    console.error('💥 Error en verificación alternativa:', error);
    return { success: false, error };
  }
}