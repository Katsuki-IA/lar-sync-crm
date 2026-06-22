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
    PostgrestVersion: "14.1"
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
      backup_lead_add55_20260417: {
        Row: {
          id_empresa: number | null
          lead_id: number | null
          numero_novo: string | null
          numero_original: string | null
        }
        Insert: {
          id_empresa?: number | null
          lead_id?: number | null
          numero_novo?: string | null
          numero_original?: string | null
        }
        Update: {
          id_empresa?: number | null
          lead_id?: number | null
          numero_novo?: string | null
          numero_original?: string | null
        }
        Relationships: []
      }
      backup_lead_dedup_20260417: {
        Row: {
          acao: string | null
          com_prefixo_55: boolean | null
          created_at: string | null
          id_empresa: number | null
          keep_id: number | null
          lead_id: number | null
          lead_nome: string | null
          numero_novo: string | null
          numero_original: string | null
          telefone_base: string | null
        }
        Insert: {
          acao?: string | null
          com_prefixo_55?: boolean | null
          created_at?: string | null
          id_empresa?: number | null
          keep_id?: number | null
          lead_id?: number | null
          lead_nome?: string | null
          numero_novo?: string | null
          numero_original?: string | null
          telefone_base?: string | null
        }
        Update: {
          acao?: string | null
          com_prefixo_55?: boolean | null
          created_at?: string | null
          id_empresa?: number | null
          keep_id?: number | null
          lead_id?: number | null
          lead_nome?: string | null
          numero_novo?: string | null
          numero_original?: string | null
          telefone_base?: string | null
        }
        Relationships: []
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
      crm_funnels: {
        Row: {
          ativo: boolean
          created_at: string
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
          id?: number
          id_empresa?: number
          is_default?: boolean
          nome?: string
          ordem?: number
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
      crm_lead_custom_fields: {
        Row: {
          ativo: boolean
          created_at: string
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
          created_at: string | null
          crm_assigned_to: string | null
          crm_stage_id: number | null
          email: string | null
          feedback: string | null
          id: number
          id_empreendimento: number | null
          id_empresa: number
          lead_id: number | null
          lead_quente: boolean | null
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
        }
        Insert: {
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          feedback?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa: number
          lead_id?: number | null
          lead_quente?: boolean | null
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
        }
        Update: {
          created_at?: string | null
          crm_assigned_to?: string | null
          crm_stage_id?: number | null
          email?: string | null
          feedback?: string | null
          id?: number
          id_empreendimento?: number | null
          id_empresa?: number
          lead_id?: number | null
          lead_quente?: boolean | null
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
          id: string
          id_empresa: number
          user_access_token: string
          user_id_meta: string
          user_name: string | null
        }
        Insert: {
          active?: boolean | null
          connected_at?: string | null
          id?: string
          id_empresa: number
          user_access_token: string
          user_id_meta: string
          user_name?: string | null
        }
        Update: {
          active?: boolean | null
          connected_at?: string | null
          id?: string
          id_empresa?: number
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
          leads_count: number | null
          page_access_token: string | null
          page_id: string
          page_name: string | null
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
          leads_count?: number | null
          page_access_token?: string | null
          page_id: string
          page_name?: string | null
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
          leads_count?: number | null
          page_access_token?: string | null
          page_id?: string
          page_name?: string | null
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
      crm_rd_connections: {
        Row: {
          access_token: string | null
          active: boolean
          connected_at: string
          created_at: string
          default_id_empreendimento: number | null
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
          id_empresa: number
          processed_at: string | null
          raw_data: Json
          received_at: string
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
          id_empresa: number
          processed_at?: string | null
          raw_data: Json
          received_at?: string
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
          id_empresa?: number
          processed_at?: string | null
          raw_data?: Json
          received_at?: string
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
            foreignKeyName: "crm_rd_events_id_empresa_fkey"
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
      crm_stages: {
        Row: {
          ativo: boolean | null
          cor: string | null
          created_at: string | null
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
          id?: number
          id_empresa?: number
          id_funnel?: number | null
          nome?: string
          ordem?: number
        }
        Relationships: [
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
          id: number
          id_empresa: number
          nome: string
        }
        Insert: {
          cor?: string | null
          created_at?: string | null
          id?: number
          id_empresa: number
          nome: string
        }
        Update: {
          cor?: string | null
          created_at?: string | null
          id?: number
          id_empresa?: number
          nome?: string
        }
        Relationships: [
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
          created_at: string | null
          default_crm: string | null
          email_aviso: string | null
          email_message: string | null
          id: number
          id_group: string | null
          id_meta_account: string | null
          id_phone_number: string | null
          nome: string
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
          created_at?: string | null
          default_crm?: string | null
          email_aviso?: string | null
          email_message?: string | null
          id?: number
          id_group?: string | null
          id_meta_account?: string | null
          id_phone_number?: string | null
          nome: string
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
          created_at?: string | null
          default_crm?: string | null
          email_aviso?: string | null
          email_message?: string | null
          id?: number
          id_group?: string | null
          id_meta_account?: string | null
          id_phone_number?: string | null
          nome?: string
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
          ativacao: boolean | null
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
        }
        Insert: {
          atendimento_humano?: boolean | null
          ativacao?: boolean | null
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
        }
        Update: {
          atendimento_humano?: boolean | null
          ativacao?: boolean | null
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
        }
        Relationships: [
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
          created_at: string
          id: number
          message: Json | null
          numero: string | null
          time: string | null
          type: string | null
        }
        Insert: {
          created_at?: string
          id?: number
          message?: Json | null
          numero?: string | null
          time?: string | null
          type?: string | null
        }
        Update: {
          created_at?: string
          id?: number
          message?: Json | null
          numero?: string | null
          time?: string | null
          type?: string | null
        }
        Relationships: []
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
      rd_steps: {
        Row: {
          contato_feito: string | null
          duplicado: string | null
          empresa_id: number
          id: number
          lead_quente: string | null
          motivo_perda_sem_interesse: string | null
          perdido_ia: string | null
          respondeu: string | null
          sem_contato: string | null
          visita_agendada: string | null
        }
        Insert: {
          contato_feito?: string | null
          duplicado?: string | null
          empresa_id: number
          id?: number
          lead_quente?: string | null
          motivo_perda_sem_interesse?: string | null
          perdido_ia?: string | null
          respondeu?: string | null
          sem_contato?: string | null
          visita_agendada?: string | null
        }
        Update: {
          contato_feito?: string | null
          duplicado?: string | null
          empresa_id?: number
          id?: number
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
        ]
      }
      steps_cv_crm: {
        Row: {
          atendimento_corretor: string | null
          base: number | null
          contacted: number | null
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
          from_wa_id: string | null
          id: string
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
          to_wa_id: string | null
          type: string | null
          updated_at: string
        }
        Insert: {
          client_message_id?: string | null
          contact_name?: string | null
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
          from_wa_id?: string | null
          id?: string
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
          to_wa_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Update: {
          client_message_id?: string | null
          contact_name?: string | null
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
          from_wa_id?: string | null
          id?: string
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
          to_wa_id?: string | null
          type?: string | null
          updated_at?: string
        }
        Relationships: []
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
      crm_get_my_empresa: { Args: never; Returns: number }
      crm_get_my_id: { Args: never; Returns: string }
      crm_get_my_role: { Args: never; Returns: string }
      crm_normalize_lead_origin: {
        Args: { p_modulo?: string | null; p_origem: string | null }
        Returns: string
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
      crm_seed_default_stages: {
        Args: { p_id_empresa: number }
        Returns: undefined
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
      purge_old_n8n_chat_conversas: { Args: never; Returns: undefined }
      send_agendamento_reminder: { Args: never; Returns: undefined }
      send_followup_leads: { Args: never; Returns: Json }
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
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
