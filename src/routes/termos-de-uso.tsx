import { createFileRoute } from "@tanstack/react-router";

import { LegalPageLayout } from "@/components/legal-page-layout";

export const Route = createFileRoute("/termos-de-uso")({
  head: () => ({
    meta: [
      { title: "Termos de Uso — Hub Katsuki" },
      {
        name: "description",
        content: "Condições aplicáveis ao acesso e à utilização do Hub Katsuki.",
      },
      { property: "og:title", content: "Termos de Uso — Hub Katsuki" },
      { property: "og:type", content: "website" },
    ],
  }),
  component: TermsOfUsePage,
});

function TermsOfUsePage() {
  return (
    <LegalPageLayout
      title="Termos de Uso"
      description="Estes Termos estabelecem as condições para acesso e utilização do Hub Katsuki, disponível em hub.katsuki.com.br."
      updatedAt="26 de agosto de 2026"
    >
      <section>
        <h2>1. Aceitação</h2>
        <p>
          Ao criar uma conta, acessar ou utilizar o Hub Katsuki, o usuário declara que leu,
          compreendeu e concorda com estes Termos e com a nossa{" "}
          <a href="/politica-de-privacidade">Política de Privacidade</a>. Caso não concorde, não
          deverá utilizar a plataforma.
        </p>
        <p>
          O usuário que atua em nome de uma empresa declara possuir autorização para representá-la e
          vinculá-la a estes Termos.
        </p>
      </section>

      <section>
        <h2>2. O Hub Katsuki</h2>
        <p>
          O Hub Katsuki é uma plataforma de gestão de relacionamento, leads, atendimentos,
          automações e integrações. Os recursos disponíveis podem variar conforme a configuração, o
          plano contratado e os serviços de terceiros conectados pelo cliente.
        </p>
        <p>
          Estes Termos regulam o acesso ao serviço online. Eles não concedem acesso ao código-fonte,
          não autorizam revenda da plataforma e não estabelecem um modelo de instalação
          auto-hospedada ou de sublicenciamento.
        </p>
      </section>

      <section>
        <h2>3. Conta e acesso</h2>
        <ul>
          <li>As informações de cadastro devem ser verdadeiras, completas e atualizadas.</li>
          <li>
            Credenciais são pessoais e devem ser protegidas. O compartilhamento indevido e qualquer
            uso realizado por meio da conta são de responsabilidade do titular e da empresa cliente.
          </li>
          <li>
            O cliente é responsável por conceder, revisar e remover acessos de seus colaboradores.
          </li>
          <li>
            Suspeitas de acesso não autorizado devem ser comunicadas à Katsuki assim que
            identificadas.
          </li>
        </ul>
      </section>

      <section>
        <h2>4. Uso permitido e responsabilidades do usuário</h2>
        <p>
          O Hub deve ser utilizado de forma lícita, ética e compatível com sua finalidade. É vedado:
        </p>
        <ul>
          <li>praticar fraude, assédio, discriminação ou qualquer atividade ilegal;</li>
          <li>enviar spam ou comunicações sem base legal ou autorização adequada;</li>
          <li>inserir conteúdo malicioso ou tentar contornar controles de acesso e segurança;</li>
          <li>copiar, explorar, descompilar ou realizar engenharia reversa da plataforma;</li>
          <li>
            interferir na disponibilidade do serviço ou acessar dados de terceiros sem permissão;
          </li>
          <li>
            utilizar integrações em desacordo com as regras da Meta, WhatsApp ou de outros
            provedores conectados.
          </li>
        </ul>
        <p>
          O cliente é responsável pelos dados, campanhas, mensagens, automações e instruções
          configuradas por seus usuários, inclusive por obter consentimentos e demais bases legais
          necessárias para tratar dados e realizar comunicações.
        </p>
      </section>

      <section>
        <h2>5. Integrações e serviços de terceiros</h2>
        <p>
          O Hub pode se integrar a serviços como Meta, WhatsApp, ferramentas de inteligência
          artificial, CRMs e provedores de infraestrutura. O uso dessas integrações também está
          sujeito aos termos e políticas de cada fornecedor.
        </p>
        <p>
          A Katsuki não controla alterações, indisponibilidades, restrições, bloqueios ou decisões
          desses terceiros. O cliente é responsável por manter suas credenciais e contas externas
          regulares e por respeitar as políticas aplicáveis.
        </p>
      </section>

      <section>
        <h2>6. Privacidade e proteção de dados</h2>
        <p>
          O tratamento de dados pessoais realizado pela Katsuki é descrito na{" "}
          <a href="/politica-de-privacidade">Política de Privacidade</a>. Em relação aos dados de
          leads, contatos e clientes inseridos no Hub por uma empresa cliente, essa empresa é
          responsável por definir as finalidades e bases legais do tratamento. A Katsuki trata esses
          dados para prestar o serviço e conforme as instruções do cliente.
        </p>
      </section>

      <section>
        <h2>7. Propriedade intelectual</h2>
        <p>
          O Hub Katsuki, sua marca, interface, software, documentação e demais componentes são
          protegidos pela legislação aplicável. O acesso à plataforma concede somente um direito
          limitado, revogável, não exclusivo e intransferível de utilização durante a vigência da
          relação com o cliente.
        </p>
        <p>
          Os dados e materiais inseridos pelo cliente permanecem sob sua responsabilidade. O cliente
          autoriza o processamento desses materiais apenas na medida necessária à operação e
          melhoria do serviço.
        </p>
      </section>

      <section>
        <h2>8. Disponibilidade e alterações do serviço</h2>
        <p>
          Buscamos manter o Hub seguro e disponível, mas poderão ocorrer manutenções, atualizações,
          falhas de internet, incidentes ou interrupções causadas por terceiros. Funcionalidades
          podem ser ajustadas para aprimoramento, segurança, conformidade legal ou compatibilidade
          com integrações.
        </p>
      </section>

      <section>
        <h2>9. Suspensão e encerramento</h2>
        <p>
          O acesso poderá ser suspenso ou encerrado em caso de violação destes Termos, risco à
          segurança, uso ilegal, inadimplência ou determinação de autoridade competente. Sempre que
          razoável e permitido, buscaremos comunicar o cliente e permitir a correção da
          irregularidade.
        </p>
        <p>
          O encerramento não elimina obrigações pendentes nem impede a conservação de registros
          exigidos ou permitidos por lei.
        </p>
      </section>

      <section>
        <h2>10. Limitação de responsabilidade</h2>
        <p>
          Na extensão permitida pela legislação, a Katsuki não responde por danos causados por uso
          indevido da plataforma, informações incorretas fornecidas pelo usuário, falhas de serviços
          de terceiros, violações das políticas de integrações ou eventos fora de seu controle
          razoável.
        </p>
        <p>
          Nenhuma disposição destes Termos exclui direitos ou responsabilidades que não possam ser
          afastados pela legislação brasileira.
        </p>
      </section>

      <section>
        <h2>11. Alterações destes Termos</h2>
        <p>
          Estes Termos poderão ser atualizados por motivos legais, operacionais ou tecnológicos. A
          versão vigente será publicada nesta página com a respectiva data. Quando a alteração for
          relevante, poderemos apresentar aviso no Hub ou utilizar os canais de contato cadastrados.
        </p>
      </section>

      <section>
        <h2>12. Legislação e contato</h2>
        <p>
          Estes Termos são regidos pelas leis da República Federativa do Brasil. Eventuais conflitos
          serão submetidos ao foro competente definido pela legislação aplicável, preservados os
          direitos assegurados ao consumidor quando incidentes.
        </p>
        <p>
          Dúvidas sobre estes Termos podem ser encaminhadas para{" "}
          <a href="mailto:fatcho@fg1.com.br">fatcho@fg1.com.br</a>.
        </p>
      </section>
    </LegalPageLayout>
  );
}
