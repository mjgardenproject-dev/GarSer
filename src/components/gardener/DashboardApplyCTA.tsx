import React from 'react'
import { useNavigate } from 'react-router-dom'

const DashboardApplyCTA: React.FC = () => {
  const navigate = useNavigate()
  return (
    <div className="max-w-3xl mx-auto mb-6 p-4 border rounded-xl bg-yellow-50">
      <div className="flex items-center justify-between">
        <div>
          <div className="font-semibold text-yellow-800">Completa tu solicitud de jardinero</div>
          <div className="text-sm text-yellow-900">Para activar tu cuenta de jardinero, termina el cuestionario.</div>
        </div>
        <button onClick={()=>navigate('/apply')} className="px-4 py-2 bg-yellow-600 text-white rounded">Ir a la solicitud</button>
      </div>
    </div>
  )
}

export default DashboardApplyCTA
