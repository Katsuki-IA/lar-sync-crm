export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      agendamento: {
        Row: {
          day: string | null
          deleted_at: string | null
          id: number
          id_empreendimento: number
          id_empresa: number
          id_lead: number | null
          time: string | null
        }
        Insert: {
          day?: string | null
          deleted_at?: string | null
          id?: number
          id_empreendimento: number
          id_empresa: number
          id_lead?: number | null
          time?: string | null
        }
        Update: {
          day?: string | null
          deleted_at?: string | null
          id?: number
          id_empreendimento?: number
          id_empresa?: number
          id_lead?: number | null
          time?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "agendamento_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamento_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "agendamento_id_lead_fkey"
            columns: ["id_lead"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
        ]
      }
      blocked_numbers: {
        Row: {
          created_at: string
          id: number
          id_empresa: number | null
          motivo_bloqueio: string | null
          numero: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          id_empresa?: number | null
          motivo_bloqueio?: string | null
          numero?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          id_empresa?: number | null
          motivo_bloqueio?: string | null
          numero?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "blocked_numbers_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      c2s_tags: {
        Row: {
          atendimento: string | null
          bloqueio_ia: string | null
          created_at: string
          desqualificado: string | null
          followup: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number | null
          perdido: string | null
          qualificado: string | null
          respondeu: string | null
          valores: string | null
          visita: string | null
        }
        Insert: {
          atendimento?: string | null
          bloqueio_ia?: string | null
          created_at?: string
          desqualificado?: string | null
          followup?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          perdido?: string | null
          qualificado?: string | null
          respondeu?: string | null
          valores?: string | null
          visita?: string | null
        }
        Update: {
          atendimento?: string | null
          bloqueio_ia?: string | null
          created_at?: string
          desqualificado?: string | null
          followup?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          perdido?: string | null
          qualificado?: string | null
          respondeu?: string | null
          valores?: string | null
          visita?: string | null
        }
        Relationships: []
      }
      credentials: {
        Row: {
          c2s_crm_token: string | null
          c2s_crm_url: string | null
          cv_crm_email: string | null
          cv_crm_token: string | null
          cv_crm_url: string | null
          default_crm: string | null
          facilita_crm_api: string | null
          facilita_crm_instance: string | null
          facilita_crm_token: string | null
          facilita_crm_url: string | null
          id: number
          id_empresa: number
          loft_crm_token: string | null
          loft_crm_url: string | null
          pipeline_id: string | null
          rd_client_id: string | null
          rd_client_secret: string | null
          rd_crm_access_token: string | null
          rd_hub_access_token: string | null
          rd_hub_client_id: string | null
          rd_hub_client_secret: string | null
          rd_hub_refresh_token: string | null
          rd_hub_token_expires_at: string | null
          rd_refresh_token: string | null
          rd_user_id: string | null
          updated_at: string | null
          waba_id: string | null
          whatsapp_access_token: string | null
          whatsapp_auth_token: string | null
          whatsapp_business_id: string | null
        }
        Insert: {
          c2s_crm_token?: string | null
          c2s_crm_url?: string | null
          cv_crm_email?: string | null
          cv_crm_token?: string | null
          cv_crm_url?: string | null
          default_crm?: string | null
          facilita_crm_api?: string | null
          facilita_crm_instance?: string | null
          facilita_crm_token?: string | null
          facilita_crm_url?: string | null
          id?: number
          id_empresa: number
          loft_crm_token?: string | null
          loft_crm_url?: string | null
          pipeline_id?: string | null
          rd_client_id?: string | null
          rd_client_secret?: string | null
          rd_crm_access_token?: string | null
          rd_hub_access_token?: string | null
          rd_hub_client_id?: string | null
          rd_hub_client_secret?: string | null
          rd_hub_refresh_token?: string | null
          rd_hub_token_expires_at?: string | null
          rd_refresh_token?: string | null
          rd_user_id?: string | null
          updated_at?: string | null
          waba_id?: string | null
          whatsapp_access_token?: string | null
          whatsapp_auth_token?: string | null
          whatsapp_business_id?: string | null
        }
        Update: {
          c2s_crm_token?: string | null
          c2s_crm_url?: string | null
          cv_crm_email?: string | null
          cv_crm_token?: string | null
          cv_crm_url?: string | null
          default_crm?: string | null
          facilita_crm_api?: string | null
          facilita_crm_instance?: string | null
          facilita_crm_token?: string | null
          facilita_crm_url?: string | null
          id?: number
          id_empresa?: number
          loft_crm_token?: string | null
          loft_crm_url?: string | null
          pipeline_id?: string | null
          rd_client_id?: string | null
          rd_client_secret?: string | null
          rd_crm_access_token?: string | null
          rd_hub_access_token?: string | null
          rd_hub_client_id?: string | null
          rd_hub_client_secret?: string | null
          rd_hub_refresh_token?: string | null
          rd_hub_token_expires_at?: string | null
          rd_refresh_token?: string | null
          rd_user_id?: string | null
          updated_at?: string | null
          waba_id?: string | null
          whatsapp_access_token?: string | null
          whatsapp_auth_token?: string | null
          whatsapp_business_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "credentials_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_conversation_classifications: {
        Row: {
          ai_count: number
          classified_at: string
          cliente_respondeu: boolean
          created_at: string
          human_count: number
          id: string
          id_empreendimento: number | null
          id_empresa: number
          lead_desqualificado: boolean
          lead_id: number
          message_count: number
          model: string | null
          motivos: string[]
          nao_respondeu_mais: boolean
          qualificado: boolean
          raw_response: Json | null
          resumo: string | null
          temperatura: string
          updated_at: string
          visita_agendada: boolean
        }
        Insert: {
          ai_count?: number
          classified_at?: string
          cliente_respondeu?: boolean
          created_at?: string
          human_count?: number
          id?: string
          id_empreendimento?: number | null
          id_empresa: number
          lead_desqualificado?: boolean
          lead_id: number
          message_count?: number
          model?: string | null
          motivos?: string[]
          nao_respondeu_mais?: boolean
          qualificado?: boolean
          raw_response?: Json | null
          resumo?: string | null
          temperatura?: string
          updated_at?: string
          visita_agendada?: boolean
        }
        Update: {
          ai_count?: number
          classified_at?: string
          cliente_respondeu?: boolean
          created_at?: string
          human_count?: number
          id?: string
          id_empreendimento?: number | null
          id_empresa?: number
          lead_desqualificado?: boolean
          lead_id?: number
          message_count?: number
          model?: string | null
          motivos?: string[]
          nao_respondeu_mais?: boolean
          qualificado?: boolean
          raw_response?: Json | null
          resumo?: string | null
          temperatura?: string
          updated_at?: string
          visita_agendada?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_conversation_classifications_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_classifications_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_conversation_classifications_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_empreendimento_atendimento: {
        Row: {
          atendimento_ativo: boolean
          created_at: string
          id: number
          id_empreendimento: number
          id_empresa: number
          updated_at: string
        }
        Insert: {
          atendimento_ativo?: boolean
          created_at?: string
          id?: number
          id_empreendimento: number
          id_empresa: number
          updated_at?: string
        }
        Update: {
          atendimento_ativo?: boolean
          created_at?: string
          id?: number
          id_empreendimento?: number
          id_empresa?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_empreendimento_atendimento_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_empreendimento_atendimento_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_crm_connections: {
        Row: {
          access_token: string | null
          account_id: string | null
          account_name: string | null
          active: boolean
          connected_at: string | null
          created_at: string
          id: string
          id_empresa: number
          last_error: string | null
          provider: string
          provider_label: string
          refresh_token: string | null
          settings: Json
          token_expires_at: string | null
          updated_at: string
        }
        Insert: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          active?: boolean
          connected_at?: string | null
          created_at?: string
          id?: string
          id_empresa: number
          last_error?: string | null
          provider: string
          provider_label: string
          refresh_token?: string | null
          settings?: Json
          token_expires_at?: string | null
          updated_at?: string
        }
        Update: {
          access_token?: string | null
          account_id?: string | null
          account_name?: string | null
          active?: boolean
          connected_at?: string | null
          created_at?: string
          id?: string
          id_empresa?: number
          last_error?: string | null
          provider?: string
          provider_label?: string
          refresh_token?: string | null
          settings?: Json
          token_expires_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_external_crm_connections_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_crm_send_logs: {
        Row: {
          connection_id: string | null
          created_at: string
          error_message: string | null
          external_id: string | null
          id: string
          id_empresa: number
          lead_id: number | null
          provider: string
          request_payload: Json | null
          response_payload: Json | null
          status: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          id_empresa: number
          lead_id?: number | null
          provider: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          error_message?: string | null
          external_id?: string | null
          id?: string
          id_empresa?: number
          lead_id?: number | null
          provider?: string
          request_payload?: Json | null
          response_payload?: Json | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_external_crm_send_logs_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_external_crm_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_external_crm_send_logs_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_external_crm_send_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_external_dispatch_queue: {
        Row: {
          attempts: number
          created_at: string
          crm_lead_id: number
          id: string
          id_empresa: number
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          processed_at: string | null
          scheduled_at: string
          status: string
          trigger_reference: string | null
          trigger_type: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          crm_lead_id: number
          id?: string
          id_empresa: number
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          processed_at?: string | null
          scheduled_at: string
          status?: string
          trigger_reference?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          created_at?: string
          crm_lead_id?: number
          id?: string
          id_empresa?: number
          last_error?: string | null
          locked_at?: string | null
          max_attempts?: number
          payload?: Json
          processed_at?: string | null
          scheduled_at?: string
          status?: string
          trigger_reference?: string | null
          trigger_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_external_dispatch_queue_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_external_dispatch_queue_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_funnels: {
        Row: {
          ativo: boolean
          created_at: string
          global_funnel_id: number | null
          id: number
          id_empresa: number
          is_default: boolean
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          global_funnel_id?: number | null
          id?: number
          id_empresa: number
          is_default?: boolean
          nome: string
          ordem?: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          global_funnel_id?: number | null
          id?: number
          id_empresa?: number
          is_default?: boolean
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_funnels_global_funnel_id_fkey"
            columns: ["global_funnel_id"]
            isOneToOne: false
            referencedRelation: "crm_global_funnel"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_global_custom_fields: {
        Row: {
          ativo: boolean
          created_at: string
          id: number
          nome: string
          obrigatorio: boolean
          opcoes: string[]
          ordem: number
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome: string
          obrigatorio?: boolean
          opcoes?: string[]
          ordem?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          id?: number
          nome?: string
          obrigatorio?: boolean
          opcoes?: string[]
          ordem?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_global_funnel: {
        Row: {
          id: number
          nome: string
          updated_at: string
        }
        Insert: {
          id?: number
          nome: string
          updated_at?: string
        }
        Update: {
          id?: number
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_global_stages: {
        Row: {
          ativo: boolean
          cor: string
          created_at: string
          id: number
          nome: string
          ordem: number
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          cor?: string
          created_at?: string
          id?: number
          nome: string
          ordem: number
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          cor?: string
          created_at?: string
          id?: number
          nome?: string
          ordem?: number
          updated_at?: string
        }
        Relationships: []
      }
      crm_global_tags: {
        Row: {
          cor: string
          created_at: string
          id: number
          nome: string
          updated_at: string
        }
        Insert: {
          cor?: string
          created_at?: string
          id?: number
          nome: string
          updated_at?: string
        }
        Update: {
          cor?: string
          created_at?: string
          id?: number
          nome?: string
          updated_at?: string
        }
        Relationships: []
      }
      crm_lead_activities: {
        Row: {
          created_at: string | null
          crm_user_id: string | null
          descricao: string | null
          id: number
          lead_id: number
          metadata: Json | null
          tipo: string
        }
        Insert: {
          created_at?: string | null
          crm_user_id?: string | null
          descricao?: string | null
          id?: number
          lead_id: number
          metadata?: Json | null
          tipo: string
        }
        Update: {
          created_at?: string | null
          crm_user_id?: string | null
          descricao?: string | null
          id?: number
          lead_id?: number
          metadata?: Json | null
          tipo?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_activities_crm_user_id_fkey"
            columns: ["crm_user_id"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_activities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_attribution: {
        Row: {
          created_at: string
          crm_lead_id: number
          fbclid: string | null
          gbraid: string | null
          gclid: string | null
          id: string
          id_empresa: number
          landing_page_url: string | null
          meta_account_id: string | null
          meta_ad_id: string | null
          meta_ad_name: string | null
          meta_adset_id: string | null
          meta_adset_name: string | null
          meta_campaign_id: string | null
          meta_campaign_name: string | null
          meta_enriched_at: string | null
          meta_enrichment_error: string | null
          meta_form_id: string | null
          meta_leadgen_id: string | null
          meta_page_id: string | null
          raw_data: Json
          referrer_url: string | null
          source_id: string | null
          source_type: string
          updated_at: string
          user_agent: string | null
          utm_ad: string | null
          utm_adgroup: string | null
          utm_campaign: string | null
          utm_content: string | null
          utm_id: string | null
          utm_medium: string | null
          utm_source: string | null
          utm_term: string | null
          wbraid: string | null
        }
        Insert: {
          created_at?: string
          crm_lead_id: number
          fbclid?: string | null
          gbraid?: string | null
          gclid?: string | null
          id?: string
          id_empresa: number
          landing_page_url?: string | null
          meta_account_id?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_enriched_at?: string | null
          meta_enrichment_error?: string | null
          meta_form_id?: string | null
          meta_leadgen_id?: string | null
          meta_page_id?: string | null
          raw_data?: Json
          referrer_url?: string | null
          source_id?: string | null
          source_type: string
          updated_at?: string
          user_agent?: string | null
          utm_ad?: string | null
          utm_adgroup?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_id?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Update: {
          created_at?: string
          crm_lead_id?: number
          fbclid?: string | null
          gbraid?: string | null
          gclid?: string | null
          id?: string
          id_empresa?: number
          landing_page_url?: string | null
          meta_account_id?: string | null
          meta_ad_id?: string | null
          meta_ad_name?: string | null
          meta_adset_id?: string | null
          meta_adset_name?: string | null
          meta_campaign_id?: string | null
          meta_campaign_name?: string | null
          meta_enriched_at?: string | null
          meta_enrichment_error?: string | null
          meta_form_id?: string | null
          meta_leadgen_id?: string | null
          meta_page_id?: string | null
          raw_data?: Json
          referrer_url?: string | null
          source_id?: string | null
          source_type?: string
          updated_at?: string
          user_agent?: string | null
          utm_ad?: string | null
          utm_adgroup?: string | null
          utm_campaign?: string | null
          utm_content?: string | null
          utm_id?: string | null
          utm_medium?: string | null
          utm_source?: string | null
          utm_term?: string | null
          wbraid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_attribution_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_attribution_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_attribution_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "crm_site_lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_custom_fields: {
        Row: {
          ativo: boolean
          created_at: string
          global_field_id: number | null
          id: number
          id_empresa: number
          nome: string
          obrigatorio: boolean
          opcoes: string[]
          ordem: number
          tipo: string
          updated_at: string
        }
        Insert: {
          ativo?: boolean
          created_at?: string
          global_field_id?: number | null
          id?: number
          id_empresa: number
          nome: string
          obrigatorio?: boolean
          opcoes?: string[]
          ordem?: number
          tipo: string
          updated_at?: string
        }
        Update: {
          ativo?: boolean
          created_at?: string
          global_field_id?: number | null
          id?: number
          id_empresa?: number
          nome?: string
          obrigatorio?: boolean
          opcoes?: string[]
          ordem?: number
          tipo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_custom_fields_global_field_id_fkey"
            columns: ["global_field_id"]
            isOneToOne: false
            referencedRelation: "crm_global_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_custom_fields_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_custom_values: {
        Row: {
          created_at: string
          field_id: number
          id: number
          lead_id: number
          updated_at: string
          valor_opcoes: string[]
          valor_texto: string | null
        }
        Insert: {
          created_at?: string
          field_id: number
          id?: number
          lead_id: number
          updated_at?: string
          valor_opcoes?: string[]
          valor_texto?: string | null
        }
        Update: {
          created_at?: string
          field_id?: number
          id?: number
          lead_id?: number
          updated_at?: string
          valor_opcoes?: string[]
          valor_texto?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_custom_values_field_id_fkey"
            columns: ["field_id"]
            isOneToOne: false
            referencedRelation: "crm_lead_custom_fields"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_custom_values_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_dispatch_settings: {
        Row: {
          created_at: string
          dispatch_delay_minutes: number
          external_stage_blocked_send_id: string | null
          external_stage_lost_id: string | null
          external_stage_qualified_id: string | null
          external_stage_unqualified_id: string | null
          external_stage_visit_scheduled_id: string | null
          external_stage_without_whatsapp_id: string | null
          id: string
          id_empresa: number
          stage_with_contact_id: number | null
          stage_without_contact_id: number | null
          updated_at: string
        }
        Insert: {
          created_at?: string
          dispatch_delay_minutes?: number
          external_stage_blocked_send_id?: string | null
          external_stage_lost_id?: string | null
          external_stage_qualified_id?: string | null
          external_stage_unqualified_id?: string | null
          external_stage_visit_scheduled_id?: string | null
          external_stage_without_whatsapp_id?: string | null
          id?: string
          id_empresa: number
          stage_with_contact_id?: number | null
          stage_without_contact_id?: number | null
          updated_at?: string
        }
        Update: {
          created_at?: string
          dispatch_delay_minutes?: number
          external_stage_blocked_send_id?: string | null
          external_stage_lost_id?: string | null
          external_stage_qualified_id?: string | null
          external_stage_unqualified_id?: string | null
          external_stage_visit_scheduled_id?: string | null
          external_stage_without_whatsapp_id?: string | null
          id?: string
          id_empresa?: number
          stage_with_contact_id?: number | null
          stage_without_contact_id?: number | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_dispatch_settings_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: true
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_dispatch_settings_stage_with_contact_id_fkey"
            columns: ["stage_with_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_dispatch_settings_stage_without_contact_id_fkey"
            columns: ["stage_without_contact_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_dispatch_stage_overrides: {
        Row: {
          created_at: string
          external_stage_blocked_send_id: string | null
          external_stage_lost_id: string | null
          external_stage_qualified_id: string | null
          external_stage_unqualified_id: string | null
          external_stage_visit_scheduled_id: string | null
          external_stage_without_whatsapp_id: string | null
          id: string
          id_empreendimento: number
          id_empresa: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          external_stage_blocked_send_id?: string | null
          external_stage_lost_id?: string | null
          external_stage_qualified_id?: string | null
          external_stage_unqualified_id?: string | null
          external_stage_visit_scheduled_id?: string | null
          external_stage_without_whatsapp_id?: string | null
          id?: string
          id_empreendimento: number
          id_empresa: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          external_stage_blocked_send_id?: string | null
          external_stage_lost_id?: string | null
          external_stage_qualified_id?: string | null
          external_stage_unqualified_id?: string | null
          external_stage_visit_scheduled_id?: string | null
          external_stage_without_whatsapp_id?: string | null
          id?: string
          id_empreendimento?: number
          id_empresa?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_dispatch_stage_overrides_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_dispatch_stage_overrides_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_tags: {
        Row: {
          created_at: string | null
          lead_id: number
          tag_id: number
        }
        Insert: {
          created_at?: string | null
          lead_id: number
          tag_id: number
        }
        Update: {
          created_at?: string | null
          lead_id?: number
          tag_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_tags_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_tags_tag_id_fkey"
            columns: ["tag_id"]
            isOneToOne: false
            referencedRelation: "crm_tags"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_lead_tasks: {
        Row: {
          assigned_to: string
          completed_at: string | null
          created_at: string
          created_by: string
          descricao: string | null
          id: string
          id_empresa: number
          lead_id: number
          prazo: string
          prioridade: Database["public"]["Enums"]["crm_task_priority"]
          status: Database["public"]["Enums"]["crm_task_status"]
          titulo: string
          updated_at: string
        }
        Insert: {
          assigned_to: string
          completed_at?: string | null
          created_at?: string
          created_by: string
          descricao?: string | null
          id?: string
          id_empresa: number
          lead_id: number
          prazo: string
          prioridade?: Database["public"]["Enums"]["crm_task_priority"]
          status?: Database["public"]["Enums"]["crm_task_status"]
          titulo: string
          updated_at?: string
        }
        Update: {
          assigned_to?: string
          completed_at?: string | null
          created_at?: string
          created_by?: string
          descricao?: string | null
          id?: string
          id_empresa?: number
          lead_id?: number
          prazo?: string
          prioridade?: Database["public"]["Enums"]["crm_task_priority"]
          status?: Database["public"]["Enums"]["crm_task_status"]
          titulo?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_lead_tasks_assigned_to_fkey"
            columns: ["assigned_to"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_tasks_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_lead_tasks_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads: {
        Row: {
          conversation_key: string | null
          created_at: string | null
          crm_assigned_to: string | null
          crm_stage_id: number | null
          email: string | null
          feedback: string | null
          historico_token: string
          id: number
          id_empreendimento: number | null
          id_empresa: number
          lead_id: number | null
          lead_quente: boolean | null
          legacy_conversation_key: string | null
          loft_id_negociacao: string | null
          nome: string
          observacoes: string | null
          origem: string
          qualificado: number | null
          rd_client_id: string | null
          rd_deal_id: string | null
          status: string | null
          tags: string[] | null
          telefone: string
          updated_at: string | null
          wa_identity_id: string | null
          wa_parent_user_id: string | null
          wa_user_id: string | null
          wa_username: string | null
        }
        Insert: {
          conversation_key?: string | null
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          feedback?: string | null
          historico_token?: string
          id?: number
          id_empreendimento?: number | null
          id_empresa: number
          lead_id?: number | null
          lead_quente?: boolean | null
          legacy_conversation_key?: string | null
          loft_id_negociacao?: string | null
          nome: string
          observacoes?: string | null
          origem?: string
          qualificado?: number | null
          rd_client_id?: string | null
          rd_deal_id?: string | null
          status?: string | null
          tags?: string[] | null
          telefone: string
          updated_at?: string | null
          wa_identity_id?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Update: {
          conversation_key?: string | null
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          feedback?: string | null
          historico_token?: string
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          lead_id?: number | null
          lead_quente?: boolean | null
          legacy_conversation_key?: string | null
          loft_id_negociacao?: string | null
          nome?: string
          observacoes?: string | null
          origem?: string
          qualificado?: number | null
          rd_client_id?: string | null
          rd_deal_id?: string | null
          status?: string | null
          tags?: string[] | null
          telefone?: string
          updated_at?: string | null
          wa_identity_id?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_crm_assigned_to_fkey"
            columns: ["crm_assigned_to"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_crm_stage_id_fkey"
            columns: ["crm_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_wa_identity_id_fkey"
            columns: ["wa_identity_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_leads_consolidated: {
        Row: {
          created_at: string | null
          data_criacao_crm: string | null
          id: string
          id_crm: string | null
          id_empreendimento: number | null
          id_empresa: number
          interesses_crm_cv: string | null
          nome: string | null
          tags: string | null
          telefone: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          data_criacao_crm?: string | null
          id?: string
          id_crm?: string | null
          id_empreendimento?: number | null
          id_empresa: number
          interesses_crm_cv?: string | null
          nome?: string | null
          tags?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          data_criacao_crm?: string | null
          id?: string
          id_crm?: string | null
          id_empreendimento?: number | null
          id_empresa?: number
          interesses_crm_cv?: string | null
          nome?: string | null
          tags?: string | null
          telefone?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_leads_consolidated_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_leads_consolidated_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meta_connections: {
        Row: {
          active: boolean | null
          connected_at: string | null
          health_status: string
          id: string
          id_empresa: number
          last_error: string | null
          last_health_check_at: string | null
          selected_page_ids: string[]
          user_access_token: string
          user_id_meta: string
          user_name: string | null
        }
        Insert: {
          active?: boolean | null
          connected_at?: string | null
          health_status?: string
          id?: string
          id_empresa: number
          last_error?: string | null
          last_health_check_at?: string | null
          selected_page_ids?: string[]
          user_access_token: string
          user_id_meta: string
          user_name?: string | null
        }
        Update: {
          active?: boolean | null
          connected_at?: string | null
          health_status?: string
          id?: string
          id_empresa?: number
          last_error?: string | null
          last_health_check_at?: string | null
          selected_page_ids?: string[]
          user_access_token?: string
          user_id_meta?: string
          user_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_meta_connections_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: true
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meta_field_mapping: {
        Row: {
          created_at: string | null
          crm_field: string
          form_id: string
          id: string
          id_empresa: number
          meta_field_key: string
        }
        Insert: {
          created_at?: string | null
          crm_field: string
          form_id: string
          id?: string
          id_empresa: number
          meta_field_key: string
        }
        Update: {
          created_at?: string | null
          crm_field?: string
          form_id?: string
          id?: string
          id_empresa?: number
          meta_field_key?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_meta_field_mapping_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meta_forms: {
        Row: {
          active: boolean | null
          connection_id: string | null
          created_at: string | null
          form_id: string
          form_name: string | null
          id: string
          id_empreendimento: number | null
          id_empresa: number
          id_funnel: number | null
          last_recovered_at: string | null
          leads_count: number | null
          page_access_token: string | null
          page_id: string
          page_name: string | null
          webhook_checked_at: string | null
          webhook_error: string | null
          webhook_subscribed: boolean
        }
        Insert: {
          active?: boolean | null
          connection_id?: string | null
          created_at?: string | null
          form_id: string
          form_name?: string | null
          id?: string
          id_empreendimento?: number | null
          id_empresa: number
          id_funnel?: number | null
          last_recovered_at?: string | null
          leads_count?: number | null
          page_access_token?: string | null
          page_id: string
          page_name?: string | null
          webhook_checked_at?: string | null
          webhook_error?: string | null
          webhook_subscribed?: boolean
        }
        Update: {
          active?: boolean | null
          connection_id?: string | null
          created_at?: string | null
          form_id?: string
          form_name?: string | null
          id?: string
          id_empreendimento?: number | null
          id_empresa?: number
          id_funnel?: number | null
          last_recovered_at?: string | null
          leads_count?: number | null
          page_access_token?: string | null
          page_id?: string
          page_name?: string | null
          webhook_checked_at?: string | null
          webhook_error?: string | null
          webhook_subscribed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_meta_forms_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_meta_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_meta_forms_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_meta_forms_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_meta_forms_id_funnel_fkey"
            columns: ["id_funnel"]
            isOneToOne: false
            referencedRelation: "crm_funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_meta_leads: {
        Row: {
          created_at: string | null
          crm_lead_id: number | null
          email: string | null
          form_id: string
          id: string
          id_empresa: number
          lead_id_meta: string
          nome: string | null
          raw_data: Json | null
          telefone: string | null
        }
        Insert: {
          created_at?: string | null
          crm_lead_id?: number | null
          email?: string | null
          form_id: string
          id?: string
          id_empresa: number
          lead_id_meta: string
          nome?: string | null
          raw_data?: Json | null
          telefone?: string | null
        }
        Update: {
          created_at?: string | null
          crm_lead_id?: number | null
          email?: string | null
          form_id?: string
          id?: string
          id_empresa?: number
          lead_id_meta?: string
          nome?: string | null
          raw_data?: Json | null
          telefone?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_meta_leads_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_meta_leads_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_metricas_sync_control: {
        Row: {
          atendimento_ia: number
          cliente_respondeu: number
          crm: string
          desqualificado: number
          finished_at: string | null
          id: number
          id_empresa: number
          last_error: string | null
          offset_atual: number
          page_limit: number
          pages_per_run: number
          perdido: number
          qualificado: number
          started_at: string
          status: string
          total_estimado: number | null
          total_processado: number
          updated_at: string
          visita_agendada: number
        }
        Insert: {
          atendimento_ia?: number
          cliente_respondeu?: number
          crm: string
          desqualificado?: number
          finished_at?: string | null
          id?: number
          id_empresa: number
          last_error?: string | null
          offset_atual?: number
          page_limit?: number
          pages_per_run?: number
          perdido?: number
          qualificado?: number
          started_at?: string
          status?: string
          total_estimado?: number | null
          total_processado?: number
          updated_at?: string
          visita_agendada?: number
        }
        Update: {
          atendimento_ia?: number
          cliente_respondeu?: number
          crm?: string
          desqualificado?: number
          finished_at?: string | null
          id?: number
          id_empresa?: number
          last_error?: string | null
          offset_atual?: number
          page_limit?: number
          pages_per_run?: number
          perdido?: number
          qualificado?: number
          started_at?: string
          status?: string
          total_estimado?: number | null
          total_processado?: number
          updated_at?: string
          visita_agendada?: number
        }
        Relationships: []
      }
      crm_notification_reads: {
        Row: {
          crm_user_id: string
          notification_id: string
          read_at: string
        }
        Insert: {
          crm_user_id: string
          notification_id: string
          read_at?: string
        }
        Update: {
          crm_user_id?: string
          notification_id?: string
          read_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notification_reads_crm_user_id_fkey"
            columns: ["crm_user_id"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_notification_reads_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "crm_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notification_targets: {
        Row: {
          id_empresa: number
          notification_id: string
        }
        Insert: {
          id_empresa: number
          notification_id: string
        }
        Update: {
          id_empresa?: number
          notification_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notification_targets_notification_id_fkey"
            columns: ["notification_id"]
            isOneToOne: false
            referencedRelation: "crm_notifications"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_notifications: {
        Row: {
          all_empresas: boolean
          created_at: string
          created_by: string | null
          id: string
          link: string | null
          mensagem: string
          titulo: string
        }
        Insert: {
          all_empresas?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          mensagem: string
          titulo: string
        }
        Update: {
          all_empresas?: boolean
          created_at?: string
          created_by?: string | null
          id?: string
          link?: string | null
          mensagem?: string
          titulo?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_notifications_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_prospeccao_leads: {
        Row: {
          attempts: number
          created_at: string
          crm_lead_id: number | null
          email: string | null
          error: string | null
          id: number
          id_empreendimento: number
          id_empresa: number
          nome: string
          origem_aba: string | null
          origem_arquivo: string | null
          processed_at: string | null
          started_at: string | null
          status: string
          telefone: string
        }
        Insert: {
          attempts?: number
          created_at?: string
          crm_lead_id?: number | null
          email?: string | null
          error?: string | null
          id?: number
          id_empreendimento: number
          id_empresa: number
          nome: string
          origem_aba?: string | null
          origem_arquivo?: string | null
          processed_at?: string | null
          started_at?: string | null
          status?: string
          telefone: string
        }
        Update: {
          attempts?: number
          created_at?: string
          crm_lead_id?: number | null
          email?: string | null
          error?: string | null
          id?: number
          id_empreendimento?: number
          id_empresa?: number
          nome?: string
          origem_aba?: string | null
          origem_arquivo?: string | null
          processed_at?: string | null
          started_at?: string | null
          status?: string
          telefone?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_prospeccao_leads_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_prospeccao_leads_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_prospeccao_leads_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_rd_connections: {
        Row: {
          access_token: string | null
          active: boolean
          connected_at: string
          created_at: string
          default_id_empreendimento: number | null
          default_id_funnel: number | null
          id: string
          id_empresa: number
          last_error: string | null
          last_event_at: string | null
          platform_account_id: string | null
          refresh_token: string | null
          token_expires_at: string | null
          updated_at: string
          webhook_secret_hash: string | null
          webhook_uuid: string | null
        }
        Insert: {
          access_token?: string | null
          active?: boolean
          connected_at?: string
          created_at?: string
          default_id_empreendimento?: number | null
          default_id_funnel?: number | null
          id?: string
          id_empresa: number
          last_error?: string | null
          last_event_at?: string | null
          platform_account_id?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          webhook_uuid?: string | null
        }
        Update: {
          access_token?: string | null
          active?: boolean
          connected_at?: string
          created_at?: string
          default_id_empreendimento?: number | null
          default_id_funnel?: number | null
          id?: string
          id_empresa?: number
          last_error?: string | null
          last_event_at?: string | null
          platform_account_id?: string | null
          refresh_token?: string | null
          token_expires_at?: string | null
          updated_at?: string
          webhook_secret_hash?: string | null
          webhook_uuid?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_rd_connections_default_id_empreendimento_fkey"
            columns: ["default_id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_connections_default_id_funnel_fkey"
            columns: ["default_id_funnel"]
            isOneToOne: false
            referencedRelation: "crm_funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_connections_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: true
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_rd_events: {
        Row: {
          connection_id: string | null
          contact_email: string | null
          contact_uuid: string | null
          crm_lead_id: number | null
          error: string | null
          event_identifier: string | null
          event_key: string
          event_timestamp: string | null
          event_type: string
          id: string
          id_empreendimento: number | null
          id_empresa: number
          id_funnel: number | null
          processed_at: string | null
          raw_data: Json
          received_at: string
          source_mapping_id: string | null
          status: string
        }
        Insert: {
          connection_id?: string | null
          contact_email?: string | null
          contact_uuid?: string | null
          crm_lead_id?: number | null
          error?: string | null
          event_identifier?: string | null
          event_key: string
          event_timestamp?: string | null
          event_type: string
          id?: string
          id_empreendimento?: number | null
          id_empresa: number
          id_funnel?: number | null
          processed_at?: string | null
          raw_data: Json
          received_at?: string
          source_mapping_id?: string | null
          status?: string
        }
        Update: {
          connection_id?: string | null
          contact_email?: string | null
          contact_uuid?: string | null
          crm_lead_id?: number | null
          error?: string | null
          event_identifier?: string | null
          event_key?: string
          event_timestamp?: string | null
          event_type?: string
          id?: string
          id_empreendimento?: number | null
          id_empresa?: number
          id_funnel?: number | null
          processed_at?: string | null
          raw_data?: Json
          received_at?: string
          source_mapping_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_rd_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_rd_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_events_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_events_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_events_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_events_id_funnel_fkey"
            columns: ["id_funnel"]
            isOneToOne: false
            referencedRelation: "crm_funnels"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_events_source_mapping_id_fkey"
            columns: ["source_mapping_id"]
            isOneToOne: false
            referencedRelation: "crm_rd_source_mappings"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_rd_source_mappings: {
        Row: {
          active: boolean
          connection_id: string
          created_at: string
          event_identifier: string
          id: string
          id_empreendimento: number | null
          id_empresa: number
          id_funnel: number | null
          last_seen_at: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          connection_id: string
          created_at?: string
          event_identifier: string
          id?: string
          id_empreendimento?: number | null
          id_empresa: number
          id_funnel?: number | null
          last_seen_at?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          connection_id?: string
          created_at?: string
          event_identifier?: string
          id?: string
          id_empreendimento?: number | null
          id_empresa?: number
          id_funnel?: number | null
          last_seen_at?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_rd_source_mappings_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_rd_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_source_mappings_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_source_mappings_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_rd_source_mappings_id_funnel_fkey"
            columns: ["id_funnel"]
            isOneToOne: false
            referencedRelation: "crm_funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_site_lead_events: {
        Row: {
          crm_lead_id: number | null
          error: string | null
          external_id: string | null
          id: string
          id_empreendimento: number | null
          id_empresa: number
          raw_data: Json
          received_at: string
          source_id: string | null
          status: string
        }
        Insert: {
          crm_lead_id?: number | null
          error?: string | null
          external_id?: string | null
          id?: string
          id_empreendimento?: number | null
          id_empresa: number
          raw_data?: Json
          received_at?: string
          source_id?: string | null
          status?: string
        }
        Update: {
          crm_lead_id?: number | null
          error?: string | null
          external_id?: string | null
          id?: string
          id_empreendimento?: number | null
          id_empresa?: number
          raw_data?: Json
          received_at?: string
          source_id?: string | null
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_site_lead_events_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_site_lead_events_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_site_lead_events_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_site_lead_events_source_id_fkey"
            columns: ["source_id"]
            isOneToOne: false
            referencedRelation: "crm_site_lead_sources"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_site_lead_sources: {
        Row: {
          active: boolean
          allowed_domains: string[]
          created_at: string
          field_mapping: Json
          id: string
          id_empreendimento: number
          id_empresa: number
          last_error: string | null
          last_lead_at: string | null
          leads_count: number
          nome: string
          origem: string
          token: string
          updated_at: string
        }
        Insert: {
          active?: boolean
          allowed_domains?: string[]
          created_at?: string
          field_mapping?: Json
          id?: string
          id_empreendimento: number
          id_empresa: number
          last_error?: string | null
          last_lead_at?: string | null
          leads_count?: number
          nome: string
          origem?: string
          token: string
          updated_at?: string
        }
        Update: {
          active?: boolean
          allowed_domains?: string[]
          created_at?: string
          field_mapping?: Json
          id?: string
          id_empreendimento?: number
          id_empresa?: number
          last_error?: string | null
          last_lead_at?: string | null
          leads_count?: number
          nome?: string
          origem?: string
          token?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_site_lead_sources_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_site_lead_sources_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_stages: {
        Row: {
          ativo: boolean | null
          cor: string | null
          created_at: string | null
          global_stage_id: number | null
          id: number
          id_empresa: number
          id_funnel: number | null
          nome: string
          ordem: number
        }
        Insert: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          global_stage_id?: number | null
          id?: number
          id_empresa: number
          id_funnel?: number | null
          nome: string
          ordem?: number
        }
        Update: {
          ativo?: boolean | null
          cor?: string | null
          created_at?: string | null
          global_stage_id?: number | null
          id?: number
          id_empresa?: number
          id_funnel?: number | null
          nome?: string
          ordem?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_stages_global_stage_id_fkey"
            columns: ["global_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_global_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stages_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_stages_id_funnel_fkey"
            columns: ["id_funnel"]
            isOneToOne: false
            referencedRelation: "crm_funnels"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_tags: {
        Row: {
          cor: string | null
          created_at: string | null
          global_tag_id: number | null
          id: number
          id_empresa: number
          nome: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          global_tag_id?: number | null
          id?: number
          id_empresa: number
          nome: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          global_tag_id?: number | null
          id?: number
          id_empresa?: number
          nome?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_tags_global_tag_id_fkey"
            columns: ["global_tag_id"]
            isOneToOne: false
            referencedRelation: "crm_global_tags"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_tags_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_users: {
        Row: {
          active: boolean | null
          auth_user_id: string | null
          created_at: string | null
          email: string
          id: string
          id_empresa: number | null
          nome: string
          role: string
          updated_at: string | null
        }
        Insert: {
          active?: boolean | null
          auth_user_id?: string | null
          created_at?: string | null
          email: string
          id?: string
          id_empresa?: number | null
          nome: string
          role: string
          updated_at?: string | null
        }
        Update: {
          active?: boolean | null
          auth_user_id?: string | null
          created_at?: string | null
          email?: string
          id?: string
          id_empresa?: number | null
          nome?: string
          role?: string
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_users_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_connections: {
        Row: {
          access_token_ciphertext: string
          activation_status: string
          business_id: string | null
          business_name: string | null
          connected_at: string
          connected_by: string | null
          created_at: string
          disconnected_at: string | null
          id: string
          id_empresa: number
          last_error: string | null
          last_health_check_at: string | null
          phone_registered: boolean
          registration_pin_ciphertext: string | null
          status: string
          token_expires_at: string | null
          updated_at: string
          waba_id: string
          webhook_subscribed: boolean
        }
        Insert: {
          access_token_ciphertext: string
          activation_status?: string
          business_id?: string | null
          business_name?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          id_empresa: number
          last_error?: string | null
          last_health_check_at?: string | null
          phone_registered?: boolean
          registration_pin_ciphertext?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          waba_id: string
          webhook_subscribed?: boolean
        }
        Update: {
          access_token_ciphertext?: string
          activation_status?: string
          business_id?: string | null
          business_name?: string | null
          connected_at?: string
          connected_by?: string | null
          created_at?: string
          disconnected_at?: string | null
          id?: string
          id_empresa?: number
          last_error?: string | null
          last_health_check_at?: string | null
          phone_registered?: boolean
          registration_pin_ciphertext?: string | null
          status?: string
          token_expires_at?: string | null
          updated_at?: string
          waba_id?: string
          webhook_subscribed?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_connections_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: true
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_onboarding_sessions: {
        Row: {
          auth_user_id: string
          consumed_at: string | null
          created_at: string
          expires_at: string
          id: string
          id_empresa: number
        }
        Insert: {
          auth_user_id: string
          consumed_at?: string | null
          created_at?: string
          expires_at: string
          id?: string
          id_empresa: number
        }
        Update: {
          auth_user_id?: string
          consumed_at?: string | null
          created_at?: string
          expires_at?: string
          id?: string
          id_empresa?: number
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_onboarding_sessions_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_phone_numbers: {
        Row: {
          active: boolean
          code_verification_status: string | null
          connection_id: string
          created_at: string
          display_phone_number: string | null
          id: string
          id_empresa: number
          name_status: string | null
          phone_number_id: string
          platform_status: string | null
          quality_rating: string | null
          updated_at: string
          verified_name: string | null
        }
        Insert: {
          active?: boolean
          code_verification_status?: string | null
          connection_id: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          id_empresa: number
          name_status?: string | null
          phone_number_id: string
          platform_status?: string | null
          quality_rating?: string | null
          updated_at?: string
          verified_name?: string | null
        }
        Update: {
          active?: boolean
          code_verification_status?: string | null
          connection_id?: string
          created_at?: string
          display_phone_number?: string | null
          id?: string
          id_empresa?: number
          name_status?: string | null
          phone_number_id?: string
          platform_status?: string | null
          quality_rating?: string | null
          updated_at?: string
          verified_name?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_phone_numbers_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_whatsapp_phone_numbers_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      crm_whatsapp_review_events: {
        Row: {
          connection_id: string | null
          created_at: string
          event_key: string
          event_type: string
          id: string
          id_empresa: number
          message_id: string | null
          occurred_at: string
          payload: Json
          phone_number_id: string | null
          source: string
        }
        Insert: {
          connection_id?: string | null
          created_at?: string
          event_key: string
          event_type: string
          id?: string
          id_empresa: number
          message_id?: string | null
          occurred_at?: string
          payload?: Json
          phone_number_id?: string | null
          source: string
        }
        Update: {
          connection_id?: string | null
          created_at?: string
          event_key?: string
          event_type?: string
          id?: string
          id_empresa?: number
          message_id?: string | null
          occurred_at?: string
          payload?: Json
          phone_number_id?: string | null
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "crm_whatsapp_review_events_connection_id_fkey"
            columns: ["connection_id"]
            isOneToOne: false
            referencedRelation: "crm_whatsapp_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "crm_whatsapp_review_events_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      empreendimento: {
        Row: {
          area_lazer: string | null
          c2s_keywords_empreendimento: string | null
          condicao: string | null
          created_at: string | null
          cv_id_empreendimento: string | null
          descricao_instrucoes: string | null
          diferenciais_condominio: string | null
          diferenciais_imovel: string | null
          endereco_visita: string | null
          fila_id_facilita_qualificado: number | null
          fila_id_facilita_visita: number | null
          google_maps_link: string | null
          id: number
          id_empresa: number
          idioma_cliente: string | null
          incorporadora: string | null
          localizacao: string | null
          mensagem_visita: string | null
          metragem: string | null
          nome: string
          numero_vagas: string | null
          outras_info: string | null
          prazo_entrega: string | null
          preco: string | null
          primeira_mensagem: string | null
          rd_empreendimento_id: string | null
          source_id_anuncio: string | null
          status: string | null
          template_msg_inicial: string | null
          tipo: string | null
          tipologia: string | null
          updated_at: string | null
        }
        Insert: {
          area_lazer?: string | null
          c2s_keywords_empreendimento?: string | null
          condicao?: string | null
          created_at?: string | null
          cv_id_empreendimento?: string | null
          descricao_instrucoes?: string | null
          diferenciais_condominio?: string | null
          diferenciais_imovel?: string | null
          endereco_visita?: string | null
          fila_id_facilita_qualificado?: number | null
          fila_id_facilita_visita?: number | null
          google_maps_link?: string | null
          id?: number
          id_empresa: number
          idioma_cliente?: string | null
          incorporadora?: string | null
          localizacao?: string | null
          mensagem_visita?: string | null
          metragem?: string | null
          nome: string
          numero_vagas?: string | null
          outras_info?: string | null
          prazo_entrega?: string | null
          preco?: string | null
          primeira_mensagem?: string | null
          rd_empreendimento_id?: string | null
          source_id_anuncio?: string | null
          status?: string | null
          template_msg_inicial?: string | null
          tipo?: string | null
          tipologia?: string | null
          updated_at?: string | null
        }
        Update: {
          area_lazer?: string | null
          c2s_keywords_empreendimento?: string | null
          condicao?: string | null
          created_at?: string | null
          cv_id_empreendimento?: string | null
          descricao_instrucoes?: string | null
          diferenciais_condominio?: string | null
          diferenciais_imovel?: string | null
          endereco_visita?: string | null
          fila_id_facilita_qualificado?: number | null
          fila_id_facilita_visita?: number | null
          google_maps_link?: string | null
          id?: number
          id_empresa?: number
          idioma_cliente?: string | null
          incorporadora?: string | null
          localizacao?: string | null
          mensagem_visita?: string | null
          metragem?: string | null
          nome?: string
          numero_vagas?: string | null
          outras_info?: string | null
          prazo_entrega?: string | null
          preco?: string | null
          primeira_mensagem?: string | null
          rd_empreendimento_id?: string | null
          source_id_anuncio?: string | null
          status?: string | null
          template_msg_inicial?: string | null
          tipo?: string | null
          tipologia?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "empreendimento_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      empresa_dados: {
        Row: {
          booking_rules: Json | null
          booking_rules_text: string | null
          c2s_company_id: string | null
          calendar_mail: string | null
          codigo_hub: string | null
          created_at: string | null
          default_crm: string | null
          email_aviso: string | null
          email_message: string | null
          id: number
          id_group: string | null
          id_meta_account: string | null
          id_phone_number: string | null
          nome: string
          nome_atendente_ia: string | null
          numero: string | null
          numero_superior: string | null
          redes_sociais: string | null
          run_report: boolean | null
          site: string | null
          template_msg_inicial: string | null
          updated_at: string | null
          webhook_status: boolean | null
        }
        Insert: {
          booking_rules?: Json | null
          booking_rules_text?: string | null
          c2s_company_id?: string | null
          calendar_mail?: string | null
          codigo_hub?: string | null
          created_at?: string | null
          default_crm?: string | null
          email_aviso?: string | null
          email_message?: string | null
          id?: number
          id_group?: string | null
          id_meta_account?: string | null
          id_phone_number?: string | null
          nome: string
          nome_atendente_ia?: string | null
          numero?: string | null
          numero_superior?: string | null
          redes_sociais?: string | null
          run_report?: boolean | null
          site?: string | null
          template_msg_inicial?: string | null
          updated_at?: string | null
          webhook_status?: boolean | null
        }
        Update: {
          booking_rules?: Json | null
          booking_rules_text?: string | null
          c2s_company_id?: string | null
          calendar_mail?: string | null
          codigo_hub?: string | null
          created_at?: string | null
          default_crm?: string | null
          email_aviso?: string | null
          email_message?: string | null
          id?: number
          id_group?: string | null
          id_meta_account?: string | null
          id_phone_number?: string | null
          nome?: string
          nome_atendente_ia?: string | null
          numero?: string | null
          numero_superior?: string | null
          redes_sociais?: string | null
          run_report?: boolean | null
          site?: string | null
          template_msg_inicial?: string | null
          updated_at?: string | null
          webhook_status?: boolean | null
        }
        Relationships: []
      }
      epura_leads: {
        Row: {
          atendido_em: string | null
          data_cadastro_cv: string
          email: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          last_error: string | null
          nome: string
          status: string
          telefone: string
          tentativas: number
        }
        Insert: {
          atendido_em?: string | null
          data_cadastro_cv?: string
          email?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          last_error?: string | null
          nome: string
          status?: string
          telefone: string
          tentativas?: number
        }
        Update: {
          atendido_em?: string | null
          data_cadastro_cv?: string
          email?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          last_error?: string | null
          nome?: string
          status?: string
          telefone?: string
          tentativas?: number
        }
        Relationships: []
      }
      error_handling: {
        Row: {
          created_at: string
          description: string | null
          id: number
          node_name: string | null
          url: string | null
          workflow_name: string | null
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: number
          node_name?: string | null
          url?: string | null
          workflow_name?: string | null
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: number
          node_name?: string | null
          url?: string | null
          workflow_name?: string | null
        }
        Relationships: []
      }
      fila_leads: {
        Row: {
          attempt_count: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          crm_provider: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number | null
          id_lead: string | null
          last_error: string | null
          processed_at: string | null
          status: string | null
          verificado: number | null
        }
        Insert: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_provider?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          id_lead?: string | null
          last_error?: string | null
          processed_at?: string | null
          status?: string | null
          verificado?: number | null
        }
        Update: {
          attempt_count?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_provider?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          id_lead?: string | null
          last_error?: string | null
          processed_at?: string | null
          status?: string | null
          verificado?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "fila_leads_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "fila_leads_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_attempts_v2: {
        Row: {
          accepted_at: string | null
          attempt_number: number
          confirmation_deadline_at: string | null
          created_at: string
          crm_delivery_notified_at: string | null
          crm_failure_notified_at: string | null
          delivered_at: string | null
          dispatch_id: number
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          id: number
          meta_message_id: string | null
          meta_response: Json
          read_at: string | null
          requested_at: string | null
          sent_at: string | null
          status: string
          updated_at: string
          wa_message_id: string | null
        }
        Insert: {
          accepted_at?: string | null
          attempt_number: number
          confirmation_deadline_at?: string | null
          created_at?: string
          crm_delivery_notified_at?: string | null
          crm_failure_notified_at?: string | null
          delivered_at?: string | null
          dispatch_id: number
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: never
          meta_message_id?: string | null
          meta_response?: Json
          read_at?: string | null
          requested_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Update: {
          accepted_at?: string | null
          attempt_number?: number
          confirmation_deadline_at?: string | null
          created_at?: string
          crm_delivery_notified_at?: string | null
          crm_failure_notified_at?: string | null
          delivered_at?: string | null
          dispatch_id?: number
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          id?: never
          meta_message_id?: string | null
          meta_response?: Json
          read_at?: string | null
          requested_at?: string | null
          sent_at?: string | null
          status?: string
          updated_at?: string
          wa_message_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followup_attempts_v2_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "followup_dispatches_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_attempts_v2_wa_message_id_fkey"
            columns: ["wa_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_crm_events_v2: {
        Row: {
          attempt_id: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          crm_provider: string | null
          crm_stage_id: string | null
          dispatch_id: number
          event_type: string
          id: number
          id_empresa: number
          last_error: string | null
          lead_id: number
          message_body: string
          metadata: Json
          processed_at: string | null
          status: string
          subject: string
          updated_at: string
          wa_message_id: string
        }
        Insert: {
          attempt_id: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_provider?: string | null
          crm_stage_id?: string | null
          dispatch_id: number
          event_type: string
          id?: never
          id_empresa: number
          last_error?: string | null
          lead_id: number
          message_body: string
          metadata?: Json
          processed_at?: string | null
          status?: string
          subject: string
          updated_at?: string
          wa_message_id: string
        }
        Update: {
          attempt_id?: number
          claimed_at?: string | null
          claimed_by?: string | null
          created_at?: string
          crm_provider?: string | null
          crm_stage_id?: string | null
          dispatch_id?: number
          event_type?: string
          id?: never
          id_empresa?: number
          last_error?: string | null
          lead_id?: number
          message_body?: string
          metadata?: Json
          processed_at?: string | null
          status?: string
          subject?: string
          updated_at?: string
          wa_message_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_crm_events_v2_attempt_id_fkey"
            columns: ["attempt_id"]
            isOneToOne: false
            referencedRelation: "followup_attempts_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_crm_events_v2_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "followup_dispatches_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_crm_events_v2_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_crm_events_v2_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_crm_events_v2_wa_message_id_fkey"
            columns: ["wa_message_id"]
            isOneToOne: false
            referencedRelation: "wa_messages"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_dispatches_v2: {
        Row: {
          cancellation_reason: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          context_snapshot: Json
          conversation_context: string
          created_at: string
          delivered_at: string | null
          dry_run: boolean
          enrollment_id: number | null
          failed_at: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          idempotency_key: string
          lead_id: number
          rendered_crm_message: string | null
          scheduled_at: string
          sent_to_meta_at: string | null
          sequence_id: number
          status: string
          step_id: number
          updated_at: string
          variant_id: number
        }
        Insert: {
          cancellation_reason?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          context_snapshot?: Json
          conversation_context: string
          created_at?: string
          delivered_at?: string | null
          dry_run?: boolean
          enrollment_id?: number | null
          failed_at?: string | null
          id?: never
          id_empreendimento?: number | null
          id_empresa: number
          idempotency_key: string
          lead_id: number
          rendered_crm_message?: string | null
          scheduled_at: string
          sent_to_meta_at?: string | null
          sequence_id: number
          status?: string
          step_id: number
          updated_at?: string
          variant_id: number
        }
        Update: {
          cancellation_reason?: string | null
          claimed_at?: string | null
          claimed_by?: string | null
          completed_at?: string | null
          context_snapshot?: Json
          conversation_context?: string
          created_at?: string
          delivered_at?: string | null
          dry_run?: boolean
          enrollment_id?: number | null
          failed_at?: string | null
          id?: never
          id_empreendimento?: number | null
          id_empresa?: number
          idempotency_key?: string
          lead_id?: number
          rendered_crm_message?: string | null
          scheduled_at?: string
          sent_to_meta_at?: string | null
          sequence_id?: number
          status?: string
          step_id?: number
          updated_at?: string
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_dispatches_v2_enrollment_id_fkey"
            columns: ["enrollment_id"]
            isOneToOne: false
            referencedRelation: "followup_enrollments_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "followup_sequences_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "followup_steps_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_dispatches_v2_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "followup_variants_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_engine_settings_v2: {
        Row: {
          created_at: string
          engine_mode: string
          id_empresa: number
          last_claimed_at: string | null
          live_batch_size: number
          metadata: Json
          updated_at: string
        }
        Insert: {
          created_at?: string
          engine_mode?: string
          id_empresa: number
          last_claimed_at?: string | null
          live_batch_size?: number
          metadata?: Json
          updated_at?: string
        }
        Update: {
          created_at?: string
          engine_mode?: string
          id_empresa?: number
          last_claimed_at?: string | null
          live_batch_size?: number
          metadata?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_engine_settings_v2_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: true
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_enrollments_v2: {
        Row: {
          cancellation_reason: string | null
          cancelled_at: string | null
          completed_at: string | null
          context_snapshot: Json
          created_at: string
          enrolled_at: string
          id: number
          last_evaluated_at: string | null
          lead_id: number
          next_step_order: number
          sequence_id: number
          status: string
          updated_at: string
        }
        Insert: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          context_snapshot?: Json
          created_at?: string
          enrolled_at?: string
          id?: never
          last_evaluated_at?: string | null
          lead_id: number
          next_step_order?: number
          sequence_id: number
          status?: string
          updated_at?: string
        }
        Update: {
          cancellation_reason?: string | null
          cancelled_at?: string | null
          completed_at?: string | null
          context_snapshot?: Json
          created_at?: string
          enrolled_at?: string
          id?: never
          last_evaluated_at?: string | null
          lead_id?: number
          next_step_order?: number
          sequence_id?: number
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_enrollments_v2_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_enrollments_v2_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "followup_sequences_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_sequences_v2: {
        Row: {
          activated_at: string | null
          audience_scope: string
          created_at: string
          delivery_timeout_minutes: number
          eligibility_mode: string
          eligibility_since: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          max_attempts: number
          metadata: Json
          nome: string
          send_window_end: string | null
          send_window_start: string | null
          status: string
          stop_on_failure: boolean
          timezone: string
          updated_at: string
        }
        Insert: {
          activated_at?: string | null
          audience_scope?: string
          created_at?: string
          delivery_timeout_minutes?: number
          eligibility_mode?: string
          eligibility_since?: string | null
          id?: never
          id_empreendimento?: number | null
          id_empresa: number
          max_attempts?: number
          metadata?: Json
          nome: string
          send_window_end?: string | null
          send_window_start?: string | null
          status?: string
          stop_on_failure?: boolean
          timezone?: string
          updated_at?: string
        }
        Update: {
          activated_at?: string | null
          audience_scope?: string
          created_at?: string
          delivery_timeout_minutes?: number
          eligibility_mode?: string
          eligibility_since?: string | null
          id?: never
          id_empreendimento?: number | null
          id_empresa?: number
          max_attempts?: number
          metadata?: Json
          nome?: string
          send_window_end?: string | null
          send_window_start?: string | null
          status?: string
          stop_on_failure?: boolean
          timezone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_sequences_v2_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_sequences_v2_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_steps: {
        Row: {
          created_at: string | null
          etapa: number
          id: number
          id_empreendimento: number | null
          id_empresa: number
          id_situacao: number | null
          id_situacao_b: number | null
          id_situacao_c: number | null
          is_active: boolean | null
          message_template: string | null
          message_template_b: string | null
          message_template_c: string | null
          minutes_delay: number
          minutes_delay_b: number | null
          minutes_delay_c: number | null
          nome: string | null
          parameters: string | null
          parameters_b: string | null
          parameters_c: string | null
          template_name: string
          template_name_b: string | null
          template_name_c: string | null
          template_name_sem_emp: string | null
          type: string | null
          updated_at: string | null
          url_imagem: string | null
          url_imagem_b: string | null
          url_imagem_c: string | null
        }
        Insert: {
          created_at?: string | null
          etapa: number
          id?: number
          id_empreendimento?: number | null
          id_empresa: number
          id_situacao?: number | null
          id_situacao_b?: number | null
          id_situacao_c?: number | null
          is_active?: boolean | null
          message_template?: string | null
          message_template_b?: string | null
          message_template_c?: string | null
          minutes_delay?: number
          minutes_delay_b?: number | null
          minutes_delay_c?: number | null
          nome?: string | null
          parameters?: string | null
          parameters_b?: string | null
          parameters_c?: string | null
          template_name: string
          template_name_b?: string | null
          template_name_c?: string | null
          template_name_sem_emp?: string | null
          type?: string | null
          updated_at?: string | null
          url_imagem?: string | null
          url_imagem_b?: string | null
          url_imagem_c?: string | null
        }
        Update: {
          created_at?: string | null
          etapa?: number
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          id_situacao?: number | null
          id_situacao_b?: number | null
          id_situacao_c?: number | null
          is_active?: boolean | null
          message_template?: string | null
          message_template_b?: string | null
          message_template_c?: string | null
          minutes_delay?: number
          minutes_delay_b?: number | null
          minutes_delay_c?: number | null
          nome?: string | null
          parameters?: string | null
          parameters_b?: string | null
          parameters_c?: string | null
          template_name?: string
          template_name_b?: string | null
          template_name_c?: string | null
          template_name_sem_emp?: string | null
          type?: string | null
          updated_at?: string | null
          url_imagem?: string | null
          url_imagem_b?: string | null
          url_imagem_c?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "followup_steps_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_steps_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_steps_v2: {
        Row: {
          created_at: string
          delay_minutes: number
          id: number
          id_situacao: number | null
          is_active: boolean
          nome: string | null
          sequence_id: number
          step_order: number
          updated_at: string
        }
        Insert: {
          created_at?: string
          delay_minutes: number
          id?: never
          id_situacao?: number | null
          is_active?: boolean
          nome?: string | null
          sequence_id: number
          step_order: number
          updated_at?: string
        }
        Update: {
          created_at?: string
          delay_minutes?: number
          id?: never
          id_situacao?: number | null
          is_active?: boolean
          nome?: string | null
          sequence_id?: number
          step_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_steps_v2_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "followup_sequences_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_test_authorizations_v2: {
        Row: {
          created_at: string
          dispatch_id: number | null
          expected_phone: string
          expires_at: string
          id: string
          id_empresa: number
          lead_id: number
          metadata: Json
          sequence_id: number
          status: string
          step_id: number
          updated_at: string
          used_at: string | null
          variant_id: number
        }
        Insert: {
          created_at?: string
          dispatch_id?: number | null
          expected_phone: string
          expires_at: string
          id?: string
          id_empresa: number
          lead_id: number
          metadata?: Json
          sequence_id: number
          status?: string
          step_id: number
          updated_at?: string
          used_at?: string | null
          variant_id: number
        }
        Update: {
          created_at?: string
          dispatch_id?: number | null
          expected_phone?: string
          expires_at?: string
          id?: string
          id_empresa?: number
          lead_id?: number
          metadata?: Json
          sequence_id?: number
          status?: string
          step_id?: number
          updated_at?: string
          used_at?: string | null
          variant_id?: number
        }
        Relationships: [
          {
            foreignKeyName: "followup_test_authorizations_v2_dispatch_id_fkey"
            columns: ["dispatch_id"]
            isOneToOne: false
            referencedRelation: "followup_dispatches_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_test_authorizations_v2_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_test_authorizations_v2_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_test_authorizations_v2_sequence_id_fkey"
            columns: ["sequence_id"]
            isOneToOne: false
            referencedRelation: "followup_sequences_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_test_authorizations_v2_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "followup_steps_v2"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "followup_test_authorizations_v2_variant_id_fkey"
            columns: ["variant_id"]
            isOneToOne: false
            referencedRelation: "followup_variants_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      followup_variants_v2: {
        Row: {
          conversation_context: string
          created_at: string
          crm_message_template: string | null
          delay_minutes: number | null
          id: number
          id_situacao: number | null
          is_active: boolean
          media_url: string | null
          meta_template_language: string
          meta_template_name: string
          metadata: Json
          parameter_mapping: Json
          step_id: number
          updated_at: string
        }
        Insert: {
          conversation_context: string
          created_at?: string
          crm_message_template?: string | null
          delay_minutes?: number | null
          id?: never
          id_situacao?: number | null
          is_active?: boolean
          media_url?: string | null
          meta_template_language?: string
          meta_template_name: string
          metadata?: Json
          parameter_mapping?: Json
          step_id: number
          updated_at?: string
        }
        Update: {
          conversation_context?: string
          created_at?: string
          crm_message_template?: string | null
          delay_minutes?: number | null
          id?: never
          id_situacao?: number | null
          is_active?: boolean
          media_url?: string | null
          meta_template_language?: string
          meta_template_name?: string
          metadata?: Json
          parameter_mapping?: Json
          step_id?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "followup_variants_v2_step_id_fkey"
            columns: ["step_id"]
            isOneToOne: false
            referencedRelation: "followup_steps_v2"
            referencedColumns: ["id"]
          },
        ]
      }
      imagens: {
        Row: {
          created_at: string | null
          descricao: string | null
          id: number
          id_empreendimento: number
          id_empresa: number
          id_imagem: string
          nome: string | null
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          descricao?: string | null
          id?: number
          id_empreendimento: number
          id_empresa: number
          id_imagem: string
          nome?: string | null
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          descricao?: string | null
          id?: number
          id_empreendimento?: number
          id_empresa?: number
          id_imagem?: string
          nome?: string | null
          updated_at?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "imagens_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "imagens_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      jmf_ativacao_temp: {
        Row: {
          atendido_em: string | null
          created_at: string
          crm_provider: string | null
          email: string | null
          empreendimento: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number | null
          last_error: string | null
          nome: string | null
          numero: string | null
          processed_at: string | null
          status: string | null
          tentativas: number | null
        }
        Insert: {
          atendido_em?: string | null
          created_at?: string
          crm_provider?: string | null
          email?: string | null
          empreendimento?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          last_error?: string | null
          nome?: string | null
          numero?: string | null
          processed_at?: string | null
          status?: string | null
          tentativas?: number | null
        }
        Update: {
          atendido_em?: string | null
          created_at?: string
          crm_provider?: string | null
          email?: string | null
          empreendimento?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number | null
          last_error?: string | null
          nome?: string | null
          numero?: string | null
          processed_at?: string | null
          status?: string | null
          tentativas?: number | null
        }
        Relationships: []
      }
      lead: {
        Row: {
          atendimento_humano: boolean | null
          atendimento_humano_desde: string | null
          ativacao: boolean | null
          conversation_key: string | null
          created_at: string | null
          crm_assigned_to: string | null
          crm_stage_id: number | null
          email: string | null
          empreendimento_em_foco_id: number | null
          empreendimento_em_foco_nome: string | null
          etapa_conversa: number | null
          feedback: string | null
          id: number
          id_crm: string | null
          id_empreendimento: number | null
          id_empresa: number
          interesse: number | null
          last_mesage: string | null
          last_message_timestamp: string | null
          lead_quente: boolean | null
          legacy_conversation_key: string | null
          loft_id_negociacao: string | null
          nome: string
          numero: string
          qtd_interacoes: number | null
          qualificado: number | null
          rd_client_id: string | null
          rd_deal_id: string | null
          status: string | null
          status_history: string | null
          ult_message: string | null
          updated_at: string | null
          wa_conversation_assigned_at: string | null
          wa_conversation_assigned_to: string | null
          wa_identity_id: string | null
          wa_parent_user_id: string | null
          wa_user_id: string | null
          wa_username: string | null
        }
        Insert: {
          atendimento_humano?: boolean | null
          atendimento_humano_desde?: string | null
          ativacao?: boolean | null
          conversation_key?: string | null
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          empreendimento_em_foco_id?: number | null
          empreendimento_em_foco_nome?: string | null
          etapa_conversa?: number | null
          feedback?: string | null
          id?: number
          id_crm?: string | null
          id_empreendimento?: number | null
          id_empresa: number
          interesse?: number | null
          last_mesage?: string | null
          last_message_timestamp?: string | null
          lead_quente?: boolean | null
          legacy_conversation_key?: string | null
          loft_id_negociacao?: string | null
          nome: string
          numero: string
          qtd_interacoes?: number | null
          qualificado?: number | null
          rd_client_id?: string | null
          rd_deal_id?: string | null
          status?: string | null
          status_history?: string | null
          ult_message?: string | null
          updated_at?: string | null
          wa_conversation_assigned_at?: string | null
          wa_conversation_assigned_to?: string | null
          wa_identity_id?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Update: {
          atendimento_humano?: boolean | null
          atendimento_humano_desde?: string | null
          ativacao?: boolean | null
          conversation_key?: string | null
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          empreendimento_em_foco_id?: number | null
          empreendimento_em_foco_nome?: string | null
          etapa_conversa?: number | null
          feedback?: string | null
          id?: number
          id_crm?: string | null
          id_empreendimento?: number | null
          id_empresa?: number
          interesse?: number | null
          last_mesage?: string | null
          last_message_timestamp?: string | null
          lead_quente?: boolean | null
          legacy_conversation_key?: string | null
          loft_id_negociacao?: string | null
          nome?: string
          numero?: string
          qtd_interacoes?: number | null
          qualificado?: number | null
          rd_client_id?: string | null
          rd_deal_id?: string | null
          status?: string | null
          status_history?: string | null
          ult_message?: string | null
          updated_at?: string | null
          wa_conversation_assigned_at?: string | null
          wa_conversation_assigned_to?: string | null
          wa_identity_id?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "lead_wa_conversation_assigned_to_fkey"
            columns: ["wa_conversation_assigned_to"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_crm_assigned_to_fkey"
            columns: ["crm_assigned_to"]
            isOneToOne: false
            referencedRelation: "crm_users"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_crm_stage_id_fkey"
            columns: ["crm_stage_id"]
            isOneToOne: false
            referencedRelation: "crm_stages"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_interesse_fkey"
            columns: ["interesse"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lead_wa_identity_id_fkey"
            columns: ["wa_identity_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      leads_backfill_control: {
        Row: {
          process_date: string
          processed_count: number
          updated_at: string
        }
        Insert: {
          process_date: string
          processed_count?: number
          updated_at?: string
        }
        Update: {
          process_date?: string
          processed_count?: number
          updated_at?: string
        }
        Relationships: []
      }
      leads_cv: {
        Row: {
          atendido_em: string | null
          crm_provider: string | null
          cv_lead_id: string | null
          data_cadastro_cv: string | null
          email: string | null
          id: number
          id_empreendimento: number | null
          id_empreendimento_cv: number | null
          id_empresa: number | null
          importado_em: string | null
          last_error: string | null
          nome: string | null
          status: string | null
          telefone: string | null
          tentativas: number | null
          ultima_conversao: string | null
        }
        Insert: {
          atendido_em?: string | null
          crm_provider?: string | null
          cv_lead_id?: string | null
          data_cadastro_cv?: string | null
          email?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empreendimento_cv?: number | null
          id_empresa?: number | null
          importado_em?: string | null
          last_error?: string | null
          nome?: string | null
          status?: string | null
          telefone?: string | null
          tentativas?: number | null
          ultima_conversao?: string | null
        }
        Update: {
          atendido_em?: string | null
          crm_provider?: string | null
          cv_lead_id?: string | null
          data_cadastro_cv?: string | null
          email?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empreendimento_cv?: number | null
          id_empresa?: number | null
          importado_em?: string | null
          last_error?: string | null
          nome?: string | null
          status?: string | null
          telefone?: string | null
          tentativas?: number | null
          ultima_conversao?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_cv_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "leads_cv_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      loft_steps: {
        Row: {
          contato_feito: string | null
          created_at: string
          id: number
          id_empresa: number | null
          respondeu: string | null
          visita_agendada: string | null
        }
        Insert: {
          contato_feito?: string | null
          created_at?: string
          id?: number
          id_empresa?: number | null
          respondeu?: string | null
          visita_agendada?: string | null
        }
        Update: {
          contato_feito?: string | null
          created_at?: string
          id?: number
          id_empresa?: number | null
          respondeu?: string | null
          visita_agendada?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "loft_steps_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      metricas_tags_crm: {
        Row: {
          atendimento_ia: number
          cliente_respondeu: number
          crm: string
          id: number
          id_empresa: number
          inserido_em: string
          perdido: number
          total_leads_unicos: number
          visita_agendada: number
        }
        Insert: {
          atendimento_ia?: number
          cliente_respondeu?: number
          crm: string
          id?: number
          id_empresa: number
          inserido_em?: string
          perdido?: number
          total_leads_unicos?: number
          visita_agendada?: number
        }
        Update: {
          atendimento_ia?: number
          cliente_respondeu?: number
          crm?: string
          id?: number
          id_empresa?: number
          inserido_em?: string
          perdido?: number
          total_leads_unicos?: number
          visita_agendada?: number
        }
        Relationships: [
          {
            foreignKeyName: "metricas_tags_crm_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_chat_analises: {
        Row: {
          analise: Json
          conversa_fim: string | null
          conversa_inicio: string | null
          created_at: string | null
          id: number
          id_empresa: number
          numero_cliente: string
          processado_relatorio: boolean | null
          total_mensagens: number | null
        }
        Insert: {
          analise: Json
          conversa_fim?: string | null
          conversa_inicio?: string | null
          created_at?: string | null
          id?: number
          id_empresa: number
          numero_cliente: string
          processado_relatorio?: boolean | null
          total_mensagens?: number | null
        }
        Update: {
          analise?: Json
          conversa_fim?: string | null
          conversa_inicio?: string | null
          created_at?: string | null
          id?: number
          id_empresa?: number
          numero_cliente?: string
          processado_relatorio?: boolean | null
          total_mensagens?: number | null
        }
        Relationships: []
      }
      n8n_chat_conversas: {
        Row: {
          conversation_key: string | null
          created_at: string
          id: number
          id_empresa: number | null
          legacy_conversation_key: string | null
          message: Json | null
          numero: string | null
          telefone: string | null
          time: string | null
          type: string | null
          wa_identity_id: string | null
          wa_user_id: string | null
          wa_username: string | null
        }
        Insert: {
          conversation_key?: string | null
          created_at?: string
          id?: number
          id_empresa?: number | null
          legacy_conversation_key?: string | null
          message?: Json | null
          numero?: string | null
          telefone?: string | null
          time?: string | null
          type?: string | null
          wa_identity_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Update: {
          conversation_key?: string | null
          created_at?: string
          id?: number
          id_empresa?: number | null
          legacy_conversation_key?: string | null
          message?: Json | null
          numero?: string | null
          telefone?: string | null
          time?: string | null
          type?: string | null
          wa_identity_id?: string | null
          wa_user_id?: string | null
          wa_username?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "n8n_chat_conversas_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "n8n_chat_conversas_wa_identity_id_fkey"
            columns: ["wa_identity_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      n8n_relatorios_consolidados: {
        Row: {
          criado_em: string | null
          id: number
          id_empresa: number
          periodo_fim: string | null
          periodo_inicio: string | null
          relatorio: Json
          total_conversas: number | null
        }
        Insert: {
          criado_em?: string | null
          id?: number
          id_empresa: number
          periodo_fim?: string | null
          periodo_inicio?: string | null
          relatorio: Json
          total_conversas?: number | null
        }
        Update: {
          criado_em?: string | null
          id?: number
          id_empresa?: number
          periodo_fim?: string | null
          periodo_inicio?: string | null
          relatorio?: Json
          total_conversas?: number | null
        }
        Relationships: []
      }
      prompt: {
        Row: {
          created_at: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          node: string | null
          prompt: string | null
          prompt_backup: string | null
          prompt_user: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa: number
          node?: string | null
          prompt?: string | null
          prompt_backup?: string | null
          prompt_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          node?: string | null
          prompt?: string | null
          prompt_backup?: string | null
          prompt_user?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      prompt_especifico: {
        Row: {
          created_at: string | null
          id: number
          id_empresa: number
          node: string
          nome_empresa: string | null
          prompt: string
          prompt_backup: string | null
          updated_at: string | null
          updated_by: string | null
        }
        Insert: {
          created_at?: string | null
          id?: number
          id_empresa: number
          node: string
          nome_empresa?: string | null
          prompt: string
          prompt_backup?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Update: {
          created_at?: string | null
          id?: number
          id_empresa?: number
          node?: string
          nome_empresa?: string | null
          prompt?: string
          prompt_backup?: string | null
          updated_at?: string | null
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "prompt_especifico_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      rd_steps: {
        Row: {
          atendimento_corretor: string | null
          contato_feito: string | null
          duplicado: string | null
          empresa_id: number
          followup1: string | null
          followup2: string | null
          followup3: string | null
          followup4: string | null
          id: number
          id_empreendimento: number | null
          lead_quente: string | null
          motivo_perda_sem_interesse: string | null
          perdido_ia: string | null
          respondeu: string | null
          sem_contato: string | null
          visita_agendada: string | null
        }
        Insert: {
          atendimento_corretor?: string | null
          contato_feito?: string | null
          duplicado?: string | null
          empresa_id: number
          followup1?: string | null
          followup2?: string | null
          followup3?: string | null
          followup4?: string | null
          id?: number
          id_empreendimento?: number | null
          lead_quente?: string | null
          motivo_perda_sem_interesse?: string | null
          perdido_ia?: string | null
          respondeu?: string | null
          sem_contato?: string | null
          visita_agendada?: string | null
        }
        Update: {
          atendimento_corretor?: string | null
          contato_feito?: string | null
          duplicado?: string | null
          empresa_id?: number
          followup1?: string | null
          followup2?: string | null
          followup3?: string | null
          followup4?: string | null
          id?: number
          id_empreendimento?: number | null
          lead_quente?: string | null
          motivo_perda_sem_interesse?: string | null
          perdido_ia?: string | null
          respondeu?: string | null
          sem_contato?: string | null
          visita_agendada?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "rd_steps_empresa_id_fkey"
            columns: ["empresa_id"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "rd_steps_id_empreendimento_fkey"
            columns: ["id_empreendimento"]
            isOneToOne: false
            referencedRelation: "empreendimento"
            referencedColumns: ["id"]
          },
        ]
      }
      steps_cv_crm: {
        Row: {
          atendimento_corretor: string | null
          base: number | null
          contacted: number | null
          followup1: number | null
          followup2: number | null
          followup3: number | null
          followup4: number | null
          ia_lost: number | null
          id: number
          id_empresa: number | null
          lost: number | null
          quente: number | null
          responded: number | null
          scheduled: number | null
          send_to_human: number | null
        }
        Insert: {
          atendimento_corretor?: string | null
          base?: number | null
          contacted?: number | null
          followup1?: number | null
          followup2?: number | null
          followup3?: number | null
          followup4?: number | null
          ia_lost?: number | null
          id?: number
          id_empresa?: number | null
          lost?: number | null
          quente?: number | null
          responded?: number | null
          scheduled?: number | null
          send_to_human?: number | null
        }
        Update: {
          atendimento_corretor?: string | null
          base?: number | null
          contacted?: number | null
          followup1?: number | null
          followup2?: number | null
          followup3?: number | null
          followup4?: number | null
          ia_lost?: number | null
          id?: number
          id_empresa?: number | null
          lost?: number | null
          quente?: number | null
          responded?: number | null
          scheduled?: number | null
          send_to_human?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "steps_cv_crm_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_contact_identities: {
        Row: {
          business_phone_number_id: string | null
          conversation_key: string | null
          created_at: string
          crm_lead_id: number | null
          display_name: string | null
          first_seen_at: string
          id: string
          id_empresa: number
          last_seen_at: string
          lead_id: number | null
          legacy_conversation_key: string | null
          raw: Json
          telefone: string | null
          updated_at: string
          username: string | null
          wa_parent_user_id: string | null
          wa_user_id: string | null
        }
        Insert: {
          business_phone_number_id?: string | null
          conversation_key?: string | null
          created_at?: string
          crm_lead_id?: number | null
          display_name?: string | null
          first_seen_at?: string
          id?: string
          id_empresa: number
          last_seen_at?: string
          lead_id?: number | null
          legacy_conversation_key?: string | null
          raw?: Json
          telefone?: string | null
          updated_at?: string
          username?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
        }
        Update: {
          business_phone_number_id?: string | null
          conversation_key?: string | null
          created_at?: string
          crm_lead_id?: number | null
          display_name?: string | null
          first_seen_at?: string
          id?: string
          id_empresa?: number
          last_seen_at?: string
          lead_id?: number | null
          legacy_conversation_key?: string | null
          raw?: Json
          telefone?: string | null
          updated_at?: string
          username?: string | null
          wa_parent_user_id?: string | null
          wa_user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_contact_identities_crm_lead_id_fkey"
            columns: ["crm_lead_id"]
            isOneToOne: false
            referencedRelation: "crm_leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contact_identities_id_empresa_fkey"
            columns: ["id_empresa"]
            isOneToOne: false
            referencedRelation: "empresa_dados"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wa_contact_identities_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "lead"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_message_status_events: {
        Row: {
          conversation: Json
          created_at: string
          dedupe_key: string
          error_code: string | null
          error_message: string | null
          id: string
          message_id: string
          phone_number_id: string
          pricing: Json
          raw: Json
          recipient_id: string | null
          status: string
          timestamp_meta: string | null
        }
        Insert: {
          conversation?: Json
          created_at?: string
          dedupe_key: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_id: string
          phone_number_id: string
          pricing?: Json
          raw?: Json
          recipient_id?: string | null
          status: string
          timestamp_meta?: string | null
        }
        Update: {
          conversation?: Json
          created_at?: string
          dedupe_key?: string
          error_code?: string | null
          error_message?: string | null
          id?: string
          message_id?: string
          phone_number_id?: string
          pricing?: Json
          raw?: Json
          recipient_id?: string | null
          status?: string
          timestamp_meta?: string | null
        }
        Relationships: []
      }
      wa_messages: {
        Row: {
          client_message_id: string | null
          contact_name: string | null
          conversation_key: string | null
          created_at: string
          crm_entity_id: string | null
          crm_entity_type: string | null
          crm_provider: string | null
          crm_sync_error: string | null
          crm_sync_status: string | null
          crm_synced_at: string | null
          delivered_at: string | null
          direction: string
          error_code: string | null
          error_message: string | null
          failed_at: string | null
          from_user_id: string | null
          from_username: string | null
          from_wa_id: string | null
          id: string
          legacy_conversation_key: string | null
          message_id: string | null
          phone_number_id: string
          raw: Json
          read_at: string | null
          sent_at: string | null
          status_current: string | null
          status_last_at: string | null
          template_language: string | null
          template_name: string | null
          template_namespace: string | null
          template_variables: Json
          tenant_id: number | null
          text_body: string | null
          timestamp_meta: string | null
          to_user_id: string | null
          to_username: string | null
          to_wa_id: string | null
          type: string | null
          updated_at: string
          wa_identity_id: string | null
        }
        Insert: {
          client_message_id?: string | null
          contact_name?: string | null
          conversation_key?: string | null
          created_at?: string
          crm_entity_id?: string | null
          crm_entity_type?: string | null
          crm_provider?: string | null
          crm_sync_error?: string | null
          crm_sync_status?: string | null
          crm_synced_at?: string | null
          delivered_at?: string | null
          direction: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_user_id?: string | null
          from_username?: string | null
          from_wa_id?: string | null
          id?: string
          legacy_conversation_key?: string | null
          message_id?: string | null
          phone_number_id: string
          raw?: Json
          read_at?: string | null
          sent_at?: string | null
          status_current?: string | null
          status_last_at?: string | null
          template_language?: string | null
          template_name?: string | null
          template_namespace?: string | null
          template_variables?: Json
          tenant_id?: number | null
          text_body?: string | null
          timestamp_meta?: string | null
          to_user_id?: string | null
          to_username?: string | null
          to_wa_id?: string | null
          type?: string | null
          updated_at?: string
          wa_identity_id?: string | null
        }
        Update: {
          client_message_id?: string | null
          contact_name?: string | null
          conversation_key?: string | null
          created_at?: string
          crm_entity_id?: string | null
          crm_entity_type?: string | null
          crm_provider?: string | null
          crm_sync_error?: string | null
          crm_sync_status?: string | null
          crm_synced_at?: string | null
          delivered_at?: string | null
          direction?: string
          error_code?: string | null
          error_message?: string | null
          failed_at?: string | null
          from_user_id?: string | null
          from_username?: string | null
          from_wa_id?: string | null
          id?: string
          legacy_conversation_key?: string | null
          message_id?: string | null
          phone_number_id?: string
          raw?: Json
          read_at?: string | null
          sent_at?: string | null
          status_current?: string | null
          status_last_at?: string | null
          template_language?: string | null
          template_name?: string | null
          template_namespace?: string | null
          template_variables?: Json
          tenant_id?: number | null
          text_body?: string | null
          timestamp_meta?: string | null
          to_user_id?: string | null
          to_username?: string | null
          to_wa_id?: string | null
          type?: string | null
          updated_at?: string
          wa_identity_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "wa_messages_wa_identity_id_fkey"
            columns: ["wa_identity_id"]
            isOneToOne: false
            referencedRelation: "wa_contact_identities"
            referencedColumns: ["id"]
          },
        ]
      }
      wa_webhook_events: {
        Row: {
          attempts: number
          dedupe_key: string
          id: number
          kind: string | null
          phone_number_id: string | null
          process_error: string | null
          processed_at: string | null
          raw: Json | null
          received_at: string
          waba_entry_id: string | null
        }
        Insert: {
          attempts?: number
          dedupe_key: string
          id?: number
          kind?: string | null
          phone_number_id?: string | null
          process_error?: string | null
          processed_at?: string | null
          raw?: Json | null
          received_at?: string
          waba_entry_id?: string | null
        }
        Update: {
          attempts?: number
          dedupe_key?: string
          id?: number
          kind?: string | null
          phone_number_id?: string | null
          process_error?: string | null
          processed_at?: string | null
          raw?: Json | null
          received_at?: string
          waba_entry_id?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      accept_followup_attempt_v2: {
        Args: {
          p_attempt_id: number
          p_meta_message_id: string
          p_meta_response?: Json
        }
        Returns: Json
      }
      activate_followup_sequence_v2: {
        Args: { p_sequence_id: number }
        Returns: Json
      }
      authorize_followup_test_v2: {
        Args: {
          p_expected_phone: string
          p_expires_at?: string
          p_lead_id: number
          p_sequence_id: number
          p_step_id: number
          p_variant_id: number
        }
        Returns: Json
      }
      cancel_followup_dispatch_by_crm_guard_v2: {
        Args: {
          p_details?: Json
          p_dispatch_id: number
          p_reason: string
          p_worker_id: string
        }
        Returns: Json
      }
      claim_authorized_followup_test_crm_event_v2: {
        Args: {
          p_authorization_id: string
          p_event_id: number
          p_worker_id: string
        }
        Returns: {
          attempt_id: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          crm_provider: string | null
          crm_stage_id: string | null
          dispatch_id: number
          event_type: string
          id: number
          id_empresa: number
          last_error: string | null
          lead_id: number
          message_body: string
          metadata: Json
          processed_at: string | null
          status: string
          subject: string
          updated_at: string
          wa_message_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_crm_events_v2"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_authorized_followup_test_v2: {
        Args: { p_authorization_id: string; p_worker_id: string }
        Returns: {
          cancellation_reason: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          context_snapshot: Json
          conversation_context: string
          created_at: string
          delivered_at: string | null
          dry_run: boolean
          enrollment_id: number | null
          failed_at: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          idempotency_key: string
          lead_id: number
          rendered_crm_message: string | null
          scheduled_at: string
          sent_to_meta_at: string | null
          sequence_id: number
          status: string
          step_id: number
          updated_at: string
          variant_id: number
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_dispatches_v2"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_followup_crm_events_v2: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          attempt_id: number
          claimed_at: string | null
          claimed_by: string | null
          created_at: string
          crm_provider: string | null
          crm_stage_id: string | null
          dispatch_id: number
          event_type: string
          id: number
          id_empresa: number
          last_error: string | null
          lead_id: number
          message_body: string
          metadata: Json
          processed_at: string | null
          status: string
          subject: string
          updated_at: string
          wa_message_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_crm_events_v2"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_followup_dispatches_v2: {
        Args: { p_limit?: number; p_worker_id: string }
        Returns: {
          cancellation_reason: string | null
          claimed_at: string | null
          claimed_by: string | null
          completed_at: string | null
          context_snapshot: Json
          conversation_context: string
          created_at: string
          delivered_at: string | null
          dry_run: boolean
          enrollment_id: number | null
          failed_at: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          idempotency_key: string
          lead_id: number
          rendered_crm_message: string | null
          scheduled_at: string
          sent_to_meta_at: string | null
          sequence_id: number
          status: string
          step_id: number
          updated_at: string
          variant_id: number
        }[]
        SetofOptions: {
          from: "*"
          to: "followup_dispatches_v2"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      complete_followup_crm_event_v2: {
        Args: {
          p_error?: string
          p_event_id: number
          p_success: boolean
          p_worker_id: string
        }
        Returns: Json
      }
      crm_assert_super_admin: { Args: never; Returns: undefined }
      crm_assignee_belongs_to_empresa: {
        Args: { p_crm_user_id: string; p_id_empresa: number }
        Returns: boolean
      }
      crm_can_access_lead: { Args: { p_lead_id: number }; Returns: boolean }
      crm_can_manage_empresa: {
        Args: { p_id_empresa: number }
        Returns: boolean
      }
      crm_claim_external_dispatch_jobs: {
        Args: { p_limit?: number }
        Returns: {
          attempts: number
          created_at: string
          crm_lead_id: number
          id: string
          id_empresa: number
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          processed_at: string | null
          scheduled_at: string
          status: string
          trigger_reference: string | null
          trigger_type: string
          updated_at: string
        }[]
        SetofOptions: {
          from: "*"
          to: "crm_external_dispatch_queue"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      crm_current_empresa_id: { Args: never; Returns: number }
      crm_current_role: { Args: never; Returns: string }
      crm_current_user_id: { Args: never; Returns: string }
      crm_empreendimento_belongs_to_empresa: {
        Args: { p_id_empreendimento: number; p_id_empresa: number }
        Returns: boolean
      }
      crm_enqueue_external_dispatch: {
        Args: {
          p_crm_lead_id: number
          p_id_empresa: number
          p_max_attempts?: number
          p_payload?: Json
          p_scheduled_at: string
          p_trigger_reference?: string
          p_trigger_type?: string
        }
        Returns: {
          attempts: number
          created_at: string
          crm_lead_id: number
          id: string
          id_empresa: number
          last_error: string | null
          locked_at: string | null
          max_attempts: number
          payload: Json
          processed_at: string | null
          scheduled_at: string
          status: string
          trigger_reference: string | null
          trigger_type: string
          updated_at: string
        }
        SetofOptions: {
          from: "*"
          to: "crm_external_dispatch_queue"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      crm_enqueue_fila_lead_if_enabled: {
        Args: {
          p_crm_lead_id: number
          p_id_empreendimento: number
          p_id_empresa: number
        }
        Returns: undefined
      }
      crm_extract_attribution_value: {
        Args: { p_keys: string[]; p_raw_data: Json }
        Returns: string
      }
      crm_generate_hub_access_code: { Args: never; Returns: string }
      crm_get_lead_attribution: {
        Args: { p_lead_id: number }
        Returns: {
          created_at: string
          gclid: string
          landing_page_url: string
          meta_ad_name: string
          meta_adset_name: string
          meta_campaign_name: string
          meta_enriched_at: string
          meta_form_id: string
          meta_page_id: string
          referrer_url: string
          source_type: string
          utm_campaign: string
          utm_content: string
          utm_medium: string
          utm_source: string
          utm_term: string
        }[]
      }
      crm_get_my_empresa: { Args: never; Returns: number }
      crm_get_my_id: { Args: never; Returns: string }
      crm_get_my_role: { Args: never; Returns: string }
      crm_get_or_create_ai_user: {
        Args: { p_id_empresa: number }
        Returns: string
      }
      crm_global_custom_field_archive: {
        Args: { p_id: number }
        Returns: undefined
      }
      crm_global_custom_field_create: {
        Args: {
          p_nome: string
          p_obrigatorio: boolean
          p_opcoes: string[]
          p_tipo: string
        }
        Returns: number
      }
      crm_global_custom_field_update: {
        Args: {
          p_id: number
          p_nome: string
          p_obrigatorio: boolean
          p_opcoes: string[]
        }
        Returns: undefined
      }
      crm_global_custom_fields_reorder: {
        Args: { p_ids: number[] }
        Returns: undefined
      }
      crm_global_funnel_rename: { Args: { p_nome: string }; Returns: undefined }
      crm_global_stage_create: { Args: { p_nome: string }; Returns: number }
      crm_global_stage_delete: { Args: { p_id: number }; Returns: undefined }
      crm_global_stage_update: {
        Args: { p_id: number; p_nome: string }
        Returns: undefined
      }
      crm_global_stages_reorder: {
        Args: { p_ids: number[] }
        Returns: undefined
      }
      crm_global_tag_create: {
        Args: { p_cor?: string; p_nome: string }
        Returns: number
      }
      crm_global_tag_delete: { Args: { p_id: number }; Returns: undefined }
      crm_global_tag_update: {
        Args: { p_cor: string; p_id: number; p_nome: string }
        Returns: undefined
      }
      crm_hub_conversation_messages: {
        Args: { p_lead_id: number }
        Returns: {
          created_at: string
          id: number
          message: Json
          numero: string
          time: string
          type: string
        }[]
      }
      crm_whatsapp_conversation_messages: {
        Args: {
          p_before_id?: number
          p_lead_id: number
          p_limit?: number
        }
        Returns: {
          created_at: string
          id: number
          message: Json
          numero: string
          time: string
          type: string
        }[]
      }
      crm_whatsapp_conversation_messages_v2: {
        Args: {
          p_before_id?: number
          p_lead_id: number
          p_limit?: number
        }
        Returns: {
          created_at: string
          delivery_status: string
          direction: string
          error_code: string
          error_message: string
          id: number
          message: Json
          numero: string
          source: string
          time: string
          transport_message_id: string
          type: string
        }[]
      }
      crm_whatsapp_list_conversations: {
        Args: {
          p_id_empresa: number
          p_limit?: number
          p_offset?: number
          p_only_human?: boolean
          p_search?: string
        }
        Returns: {
          assigned_at: string
          assigned_name: string
          assigned_to: string
          atendimento_humano: boolean
          atendimento_humano_desde: string
          conversation_key: string
          display_name: string
          id_crm: string
          id_empresa: number
          last_message: string
          last_message_at: string
          lead_id: number
          legacy_conversation_key: string
          nome: string
          status: string
          telefone: string
          total_count: number
          wa_identity_id: string
          wa_user_id: string
          wa_username: string
        }[]
      }
      crm_whatsapp_set_conversation_attendance: {
        Args: { p_enabled: boolean; p_force?: boolean; p_lead_id: number }
        Returns: {
          assigned_at: string
          assigned_name: string
          assigned_to: string
          atendimento_humano: boolean
          atendimento_humano_desde: string
          id_empresa: number
          lead_id: number
        }[]
      }
      crm_ingest_meta_lead: {
        Args: {
          p_crm_assigned_to: string
          p_crm_stage_id: number
          p_email: string
          p_form_id: string
          p_id_empreendimento: number
          p_id_empresa: number
          p_lead_id_meta: string
          p_nome: string
          p_observacoes: string
          p_origem: string
          p_raw_data: Json
          p_telefone: string
        }
        Returns: {
          created_lead_id: number
          was_inserted: boolean
        }[]
      }
      crm_ingest_site_lead: {
        Args: {
          p_email?: string
          p_external_id?: string
          p_id_empreendimento: number
          p_id_empresa: number
          p_nome: string
          p_observacoes?: string
          p_origem?: string
          p_raw_data?: Json
          p_source_id: string
          p_telefone: string
        }
        Returns: {
          event_id: string
          inserted: boolean
          lead_id: number
        }[]
      }
      crm_normalize_lead_origin: {
        Args: { p_modulo?: string; p_origem: string }
        Returns: string
      }
      crm_pause_ai_attendance: {
        Args: { p_lead_id: number }
        Returns: undefined
      }
      crm_process_next_prospeccao_leads: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: {
          action: string
          crm_lead_id: number
          error: string
          staging_id: number
        }[]
      }
      crm_public_lead_history: {
        Args: { p_codigo: string; p_lead_ref: string }
        Returns: Json
      }
      crm_record_lead_attribution: {
        Args: {
          p_crm_lead_id: number
          p_fbclid?: string
          p_gbraid?: string
          p_gclid?: string
          p_id_empresa: number
          p_landing_page_url?: string
          p_meta_ad_id?: string
          p_meta_adset_id?: string
          p_meta_campaign_id?: string
          p_meta_form_id?: string
          p_meta_leadgen_id?: string
          p_meta_page_id?: string
          p_raw_data?: Json
          p_referrer_url?: string
          p_source_id?: string
          p_source_type: string
          p_user_agent?: string
          p_utm_ad?: string
          p_utm_adgroup?: string
          p_utm_campaign?: string
          p_utm_content?: string
          p_utm_id?: string
          p_utm_medium?: string
          p_utm_source?: string
          p_utm_term?: string
          p_wbraid?: string
        }
        Returns: string
      }
      crm_seed_default_stages: {
        Args: { p_id_empresa: number }
        Returns: undefined
      }
      crm_seed_default_tags: {
        Args: { p_id_empresa: number }
        Returns: undefined
      }
      crm_stage_belongs_to_empresa: {
        Args: { p_id_empresa: number; p_stage_id: number }
        Returns: boolean
      }
      crm_sync_company_global_config: {
        Args: { p_id_empresa: number }
        Returns: undefined
      }
      crm_sync_company_global_custom_fields: {
        Args: { p_id_empresa: number }
        Returns: undefined
      }
      enqueue_authorized_followup_test_v2: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      enqueue_followup_crm_event_v2: {
        Args: { p_attempt_id: number; p_event_type: string }
        Returns: Json
      }
      enqueue_followup_dispatches_v2: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: Json
      }
      fail_followup_attempt_v2: {
        Args: {
          p_attempt_id: number
          p_error_code: string
          p_error_message: string
          p_meta_response?: Json
          p_retryable?: boolean
        }
        Returns: Json
      }
      fair_live_followup_candidates_v2: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: {
          audience_scope: string
          conversation_context: string
          crm_message_template: string
          effective_project_id: number
          eligibility_reason: string
          eligible_at: string
          id_empresa: number
          id_situacao: number
          last_message_at: string
          lead_id: number
          lead_id_crm: string
          lead_nome: string
          lead_telefone: string
          media_url: string
          meta_template_language: string
          meta_template_name: string
          parameter_mapping: Json
          sequence_id: number
          sequence_name: string
          step_id: number
          step_order: number
          variant_id: number
        }[]
      }
      followup_context_v2: {
        Args: { p_qtd_interacoes: number; p_status: string }
        Returns: string
      }
      followup_crm_pre_send_context_v2: {
        Args: { p_dispatch_id: number; p_worker_id: string }
        Returns: Json
      }
      followup_dispatch_validation_v2: {
        Args: { p_dispatch_id: number }
        Returns: string
      }
      followup_engine_mode_v2: {
        Args: { p_id_empresa: number }
        Returns: string
      }
      followup_sequence_readiness_v2: {
        Args: { p_sequence_id: number }
        Returns: Json
      }
      followup_try_timestamptz_v2: {
        Args: { p_value: string }
        Returns: string
      }
      followup_within_send_window_v2: {
        Args: {
          p_instant?: string
          p_timezone: string
          p_window_end: string
          p_window_start: string
        }
        Returns: boolean
      }
      get_analises_para_relatorio: {
        Args: { p_id_empresa?: number }
        Returns: {
          analises: Json
          data_fim: string
          data_inicio: string
          id_empresa: number
          ids_analises: number[]
          total_conversas: number
        }[]
      }
      get_conversas_para_analise:
        | {
            Args: { dias_atras?: number; min_msgs?: number }
            Returns: {
              fim: string
              id_empresa: number
              inicio: string
              mensagens: Json
              numero_cliente: string
              total_msgs: number
            }[]
          }
        | {
            Args: { p_id_empresa: number }
            Returns: {
              fim: string
              id_empresa: number
              inicio: string
              mensagens: Json
              numero_cliente: string
              total_msgs: number
            }[]
          }
      get_cron_job_runs: {
        Args: { p_limit?: number }
        Returns: {
          command: string
          database: string
          end_time: string
          job_pid: number
          jobid: number
          return_message: string
          runid: number
          start_time: string
          status: string
          username: string
        }[]
      }
      get_cron_jobs: {
        Args: never
        Returns: {
          active: boolean
          command: string
          database: string
          jobid: number
          jobname: string
          nodename: string
          nodeport: number
          schedule: string
          username: string
        }[]
      }
      get_empreendimento: {
        Args: { p_id_empresa: number }
        Returns: {
          area_lazer: string
          condicao: string
          diferenciais_condominio: string
          diferenciais_imovel: string
          endereco_visita: string
          google_maps_link: string
          id: number
          incorporadora: string
          localizacao: string
          metragem: string
          nome: string
          numero_vagas: string
          outras_info: string
          prazo_entrega: string
          preco: string
          primeira_mensagem: string
          redes_sociais: string
          site: string
          status: string
          tipo: string
          tipologia: string
        }[]
      }
      get_empresa_by_cvcrm_tenant: {
        Args: { p_tenant: string }
        Returns: {
          cv_crm_url_db: string
          cv_norm: string
          empresa_id: number
          match_mode: string
          tenant_in: string
          tenant_norm: string
        }[]
      }
      get_full_schema_info: { Args: never; Returns: Json }
      gloria_leads_por_empreendimento: {
        Args: { p_mes: string }
        Returns: Json
      }
      import_followup_v1_config_v2: {
        Args: { p_id_empresa: number }
        Returns: Json
      }
      insert_wa_status_event: {
        Args: {
          p_dedupe_key: string
          p_error_code: string
          p_error_message: string
          p_message_id: string
          p_phone_number_id: string
          p_raw: Json
          p_recipient_id: string
          p_status: string
          p_timestamp_meta: string
        }
        Returns: undefined
      }
      live_followup_candidates_v2: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: {
          audience_scope: string
          conversation_context: string
          crm_message_template: string
          effective_project_id: number
          eligibility_reason: string
          eligible_at: string
          id_empresa: number
          id_situacao: number
          last_message_at: string
          lead_id: number
          lead_id_crm: string
          lead_nome: string
          lead_telefone: string
          media_url: string
          meta_template_language: string
          meta_template_name: string
          parameter_mapping: Json
          sequence_id: number
          sequence_name: string
          step_id: number
          step_order: number
          variant_id: number
        }[]
      }
      mark_followup_confirmation_timeouts_v2: {
        Args: { p_limit?: number }
        Returns: Json
      }
      prepare_followup_attempt_v2: {
        Args: { p_dispatch_id: number; p_worker_id: string }
        Returns: Json
      }
      preview_followup_candidates_v2: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: {
          audience_scope: string
          conversation_context: string
          crm_message_template: string
          effective_project_id: number
          eligibility_reason: string
          eligible_at: string
          id_empresa: number
          id_situacao: number
          last_message_at: string
          lead_id: number
          lead_nome: string
          lead_telefone: string
          media_url: string
          meta_template_language: string
          meta_template_name: string
          parameter_mapping: Json
          sequence_id: number
          sequence_name: string
          step_id: number
          step_order: number
          variant_id: number
        }[]
      }
      preview_followup_test_v2: {
        Args: { p_authorization_id: string }
        Returns: Json
      }
      purge_old_n8n_chat_conversas: { Args: never; Returns: undefined }
      reconcile_followup_attempts_v2: {
        Args: { p_limit?: number }
        Returns: Json
      }
      revalidate_followup_dispatch_v2: {
        Args: { p_dispatch_id: number; p_worker_id: string }
        Returns: Json
      }
      send_agendamento_reminder: { Args: never; Returns: undefined }
      send_followup_leads: { Args: never; Returns: Json }
      set_followup_engine_mode_v2: {
        Args: { p_engine_mode: string; p_id_empresa: number }
        Returns: Json
      }
      simulate_followup_dispatches_v2: {
        Args: { p_id_empresa?: number; p_limit?: number }
        Returns: Json
      }
      upsert_leads_batch: { Args: { leads_data: Json }; Returns: undefined }
    }
    Enums: {
      crm_task_priority: "baixa" | "normal" | "alta"
      crm_task_status:
        | "pendente"
        | "em_andamento"
        | "concluida"
        | "vencida"
        | "cancelada"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      crm_task_priority: ["baixa", "normal", "alta"],
      crm_task_status: [
        "pendente",
        "em_andamento",
        "concluida",
        "vencida",
        "cancelada",
      ],
    },
  },
} as const
