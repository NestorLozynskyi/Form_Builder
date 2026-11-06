# syntax=docker/dockerfile:1
FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src
COPY global.json ./
COPY src/FormBuilder.Api/FormBuilder.Api.csproj src/FormBuilder.Api/
RUN dotnet restore src/FormBuilder.Api/FormBuilder.Api.csproj
COPY src/ src/
RUN dotnet publish src/FormBuilder.Api/FormBuilder.Api.csproj -c Release -o /app --no-restore /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
ENV ASPNETCORE_HTTP_PORTS=8080 \
    DOTNET_NOLOGO=1
COPY --from=build /app ./
USER $APP_UID
EXPOSE 8080
# The aspnet image has no curl/wget: use bash /dev/tcp to call the health endpoint (checks DB too).
HEALTHCHECK --interval=10s --timeout=5s --start-period=20s --retries=5 \
  CMD ["bash", "-c", "exec 3<>/dev/tcp/127.0.0.1/${ASPNETCORE_HTTP_PORTS:-8080} && printf 'GET /api/health HTTP/1.1\\r\\nHost: localhost\\r\\nConnection: close\\r\\n\\r\\n' >&3 && head -n1 <&3 | grep -q ' 200 '"]
ENTRYPOINT ["dotnet", "FormBuilder.Api.dll"]
