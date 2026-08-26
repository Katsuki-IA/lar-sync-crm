import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/legal-page-layout";

export const Route = createFileRoute("/politica-de-privacidade")({
  head: () => ({
    meta: [
      { title: "Política de Privacidade — Hub Katsuki" },
      {
        name: "description",
        content: "Saiba como o Hub Katsuki coleta, utiliza, armazena e protege dados pessoais.",
      },
      { property: "og:title", content: "Política de Privacidade — Hub Katsuki" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: PrivacyPolicyPage,
});

function PrivacyPolicyPage() {
  return (
    <LegalPageLayout
      title="Política de Privacidade"
      description="Esta Política explica como a Katsuki trata dados pessoais no Hub Katsuki, em seus formulários, integrações, campanhas e demais canais digitais."
      updatedAt="26 de agosto de 2026"
    >
      <section>
        <h2>1. Abrangência e responsabilidades</h2>
        <p>
          Esta Política se aplica ao Hub Katsuki e aos ambientes digitais operados pela Katsuki.
          Quando uma empresa cliente utiliza o Hub para administrar seus próprios leads e contatos,
          essa empresa decide as finalidades do tratamento e atua como controladora desses dados. A
          Katsuki atua como operadora, tratando-os conforme as instruções da empresa cliente e a
          legislação aplicável.
        </p>
      </section>

      <section>
        <h2>2. Dados que podemos coletar</h2>
        <p>Dependendo da forma de interação com o Hub, podemos tratar:</p>
        <ul>
          <li>
            <strong>Dados informados pelo usuário:</strong> nome, telefone, e-mail, cidade, empresa,
            cargo, interesses e outras informações inseridas em formulários, chats ou páginas.
          </li>
          <li>
            <strong>Dados de conta e uso:</strong> informações de cadastro, perfil, permissões,
            registros de acesso e atividades realizadas na plataforma.
          </li>
          <li>
            <strong>Dados técnicos:</strong> endereço IP, navegador, dispositivo, páginas acessadas,
            horários, duração da navegação, cookies e identificadores semelhantes.
          </li>
          <li>
            <strong>Dados de campanhas e integrações:</strong> origem do lead, anúncios, parâmetros
            de campanha e informações recebidas de serviços conectados, incluindo plataformas da
            Meta.
          </li>
          <li>
            <strong>Comunicações:</strong> mensagens e registros necessários ao atendimento,
            automações e acompanhamento de oportunidades, conforme a configuração do cliente.
          </li>
        </ul>
      </section>

      <section>
        <h2>3. Como utilizamos os dados</h2>
        <p>Os dados podem ser tratados para:</p>
        <ul>
          <li>fornecer, operar, proteger e melhorar o Hub Katsuki;</li>
          <li>criar e administrar contas, permissões, leads e históricos de atendimento;</li>
          <li>atender solicitações e permitir comunicações relacionadas aos serviços;</li>
          <li>executar automações, integrações, análises, métricas e segmentações;</li>
          <li>enviar conteúdos, novidades ou ofertas quando houver uma base legal válida;</li>
          <li>detectar fraudes, abusos, falhas técnicas e incidentes de segurança;</li>
          <li>cumprir contratos, obrigações legais, regulatórias ou ordens de autoridades.</li>
        </ul>
        <p>
          O tratamento poderá se basear, conforme o caso, no consentimento, na execução de contrato,
          no cumprimento de obrigação legal, no exercício regular de direitos ou em interesses
          legítimos avaliados de acordo com a Lei Geral de Proteção de Dados (LGPD).
        </p>
      </section>

      <section>
        <h2>4. Compartilhamento e integrações</h2>
        <p>
          Podemos compartilhar dados, na medida necessária, com provedores de hospedagem e nuvem,
          ferramentas de CRM, automação, inteligência artificial, mensageria, análise, mídia e
          suporte técnico. Dados também podem ser enviados a integrações habilitadas pelo cliente,
          como Meta, WhatsApp e CRMs externos.
        </p>
        <p>
          Esses terceiros possuem suas próprias regras de privacidade. Não vendemos dados pessoais.
          Também poderemos compartilhar informações para cumprir a lei, proteger direitos ou atender
          determinações de autoridades competentes.
        </p>
      </section>

      <section>
        <h2>5. Cookies e tecnologias semelhantes</h2>
        <p>
          O Hub pode utilizar cookies necessários à autenticação e à segurança, além de tecnologias
          de desempenho, medição e publicidade. O usuário pode gerenciar cookies nas configurações
          do navegador, sabendo que o bloqueio de cookies essenciais pode impedir algumas funções da
          plataforma.
        </p>
      </section>

      <section>
        <h2>6. Armazenamento, segurança e transferências</h2>
        <p>
          Adotamos medidas técnicas e administrativas razoáveis para reduzir riscos de perda, uso
          indevido, alteração, divulgação ou acesso não autorizado. Nenhum ambiente digital é
          totalmente imune a incidentes, mas revisamos continuamente nossas práticas de proteção.
        </p>
        <p>
          Alguns fornecedores podem processar dados fora do Brasil. Nesses casos, buscamos utilizar
          mecanismos compatíveis com a LGPD e exigir proteção adequada das informações.
        </p>
      </section>

      <section>
        <h2>7. Retenção dos dados</h2>
        <p>
          Mantemos os dados pelo período necessário para prestar os serviços, atender às finalidades
          informadas, preservar registros de segurança, exercer direitos e cumprir obrigações legais
          ou regulatórias. Ao final, os dados poderão ser eliminados ou anonimizados, salvo quando a
          conservação for permitida ou exigida por lei.
        </p>
      </section>

      <section>
        <h2>8. Direitos dos titulares</h2>
        <p>Nos termos da LGPD, o titular pode solicitar, quando aplicável:</p>
        <ul>
          <li>confirmação da existência de tratamento e acesso aos dados;</li>
          <li>correção de informações incompletas, inexatas ou desatualizadas;</li>
          <li>anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares;</li>
          <li>portabilidade e informações sobre compartilhamentos;</li>
          <li>eliminação de dados tratados com consentimento e revogação do consentimento;</li>
          <li>revisão de decisões tomadas unicamente com base em tratamento automatizado.</li>
        </ul>
        <p>
          Quando os dados tiverem sido coletados por uma empresa cliente do Hub, a solicitação
          poderá precisar ser direcionada a essa empresa. A Katsuki prestará a assistência cabível.
        </p>
      </section>

      <section>
        <h2>9. Solicitações e contato</h2>
        <p>
          Para dúvidas ou solicitações relacionadas à privacidade, envie um e-mail para{" "}
          <a href="mailto:fatcho@fg1.com.br">fatcho@fg1.com.br</a>. Para pedidos específicos de
          remoção, consulte também nossa{" "}
          <a href="/privacidade/exclusao-de-dados">página de Exclusão de Dados</a>.
        </p>
      </section>

      <section>
        <h2>10. Alterações desta Política</h2>
        <p>
          Esta Política poderá ser atualizada para refletir mudanças legais, operacionais ou
          tecnológicas. A versão vigente e sua data de atualização permanecerão disponíveis nesta
          página.
        </p>
      </section>
    </LegalPageLayout>
  );
}
